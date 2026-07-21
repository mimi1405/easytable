import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { AddressInfo } from "node:net";
import type { BasketLine, PaymentResult } from "../types.js";

const authenticationKey = Buffer.from("local-wallee-contract-key-32-bytes").toString("base64");
const transactionStates = new Map<string, string>();
const transactionReferences = new Map<string, string>();
const performCalls = new Map<string, number>();
const createCalls = new Map<string, number>();
const confirmCalls = new Map<string, number>();
const refundBodies: Array<Record<string, unknown>> = [];
let relayPayload: any;

const walleeServer = createServer(async (request, response) => handleWalleeRequest(request, response));
const relayServer = createServer(async (request, response) => handleRelayRequest(request, response));
await listen(walleeServer);
await listen(relayServer);
const walleeBaseUrl = "http://127.0.0.1:" + (walleeServer.address() as AddressInfo).port + "/api/v2.0";
const relayBaseUrl = "http://127.0.0.1:" + (relayServer.address() as AddressInfo).port;

process.env.NODE_ENV = "test";
process.env.LOCAL_MASTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "easytable-wallee-test-")), "local-master.sqlite3");
process.env.LOCAL_MASTER_DISABLE_POWERSYNC = "1";
process.env.LOCAL_MASTER_DISABLE_NATS = "1";
process.env.LOCAL_MASTER_WALLEE_ENCRYPTION_KEY = "test-local-encryption-key";
process.env.WALLEE_API_BASE_URL = walleeBaseUrl;
process.env.WALLEE_CLOUD_TILL_LONG_POLL_ATTEMPTS = "3";
process.env.WALLEE_CLOUD_TILL_REQUEST_TIMEOUT_MS = "5000";
process.env.WALLEE_SERVER_ERROR_RETRY_ATTEMPTS = "2";

const { buildServer } = await import("../server.js");
const { getDrizzleDatabase } = await import("../db/client.js");
const { localWalleeConfig, orderSnapshots, paymentAttempts, paymentReceipts, paymentRecoveryJobs, salesLedgerEntries } = await import("../db/schema.js");
const { pullAndActivateWalleeConfig, getWalleeConfigStatus } = await import("../store/walleeConfigStore.js");
const { WalleeClient } = await import("../store/walleeClient.js");
const { startWalleeTerminalPayment } = await import("../store/orderStore.js");
const { getLocalMasterIdentity } = await import("../pairing.js");
const { eq } = await import("drizzle-orm");
const app = await buildServer({ logger: false });

before(async () => {
  relayPayload = paymentConfig(1, true);
  await pullAndActivateWalleeConfig(binding());
});

after(async () => {
  await app.close();
  await close(walleeServer);
  await close(relayServer);
});

test("cash payments stay local and are idempotent", async () => {
  const request = cashRequest("cash-idempotent", 1200);
  const first = await post<PaymentResult>("/api/payments/cash/complete", request, 201);
  const replay = await post<PaymentResult>("/api/payments/cash/complete", request, 201);
  assert.equal(replay.payment_id, first.payment_id);
  assert.equal(replay.lifecycle_state, "completed");
});

test("legacy payment endpoint is removed", async () => {
  const response = await app.inject({ method: "POST", url: "/api/mock-payments/complete", payload: { request: cashRequest("legacy", 500) } });
  assert.equal(response.statusCode, 404);
});

test("terminal validation resolves a stale entity id through the terminal identifier", async () => {
  const client = new WalleeClient({ spaceId: "30140", applicationUserId: "12345", authenticationKey });
  const terminal = await client.resolveTerminal({ terminalId: "missing", terminalIdentifier: "89990002303" });
  assert.equal(String(terminal.id), "32581002");
});

test("localMaster executes Wallee create, confirm, perform, read and receipts directly", async () => {
  const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-success-500",
    lines: [line("success", 500)],
    table_context: null
  }, 201);
  assert.equal(payment.provider, "WALLEE_CLOUD_TILL");
  assert.equal(payment.provider_status, "COMPLETED");
  assert.equal(payment.lifecycle_state, "completed");
  assert.equal(payment.reconciliation_required, false);
  const receipt = getDrizzleDatabase().select().from(paymentReceipts).where(eq(paymentReceipts.paymentAttemptId, payment.payment_attempt_id!)).get();
  assert.equal(receipt?.mimeType, "application/pdf");
  assert.equal(Buffer.from(receipt?.dataBase64 ?? "", "base64").toString("utf8"), "receipt");
});

test("completed Wallee payment creates one immutable snapshot and two ledger records", async () => {
  const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-financial-persistence",
    lines: [line("financial-persistence", 500)],
    table_context: null
  }, 201);
  const snapshots = getDrizzleDatabase().select().from(orderSnapshots).where(eq(orderSnapshots.orderId, payment.order_id)).all();
  const ledger = getDrizzleDatabase().select().from(salesLedgerEntries).where(eq(salesLedgerEntries.orderId, payment.order_id)).all();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.provider, "WALLEE_CLOUD_TILL");
  assert.equal(snapshots[0]?.providerTransactionId, payment.provider_transaction_id);
  assert.deepEqual(ledger.map((entry) => entry.entryType).sort(), ["PAYMENT_RECORDED", "SALE_COMPLETED"]);

  const replay = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-financial-persistence",
    lines: [line("financial-persistence", 500)],
    table_context: null
  }, 201);
  assert.equal(replay.payment_id, payment.payment_id);
  assert.equal(getDrizzleDatabase().select().from(orderSnapshots).where(eq(orderSnapshots.orderId, payment.order_id)).all().length, 1);
  assert.equal(getDrizzleDatabase().select().from(salesLedgerEntries).where(eq(salesLedgerEntries.orderId, payment.order_id)).all().length, 2);
});

test("invalid receipt data never enters persistence and is scheduled for recovery", async () => {
  const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-receipt-invalid",
    lines: [line("receipt-invalid", 500)],
    table_context: null
  }, 201);
  const receipt = getDrizzleDatabase().select().from(paymentReceipts).where(eq(paymentReceipts.paymentAttemptId, payment.payment_attempt_id!)).get();
  const recovery = getDrizzleDatabase().select().from(paymentRecoveryJobs).where(eq(paymentRecoveryJobs.paymentAttemptId, payment.payment_attempt_id!)).all();
  assert.equal(receipt, undefined);
  assert.equal(recovery.some((job) => job.operation === "FETCH_RECEIPTS"), true);
});

test("HTTP 543 resumes the same transaction without a duplicate", async () => {
  const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-543-success",
    lines: [line("retry", 500)],
    table_context: null
  }, 201);
  assert.equal(payment.lifecycle_state, "completed");
  assert.equal(performCalls.get(payment.provider_transaction_id ?? ""), 2);
  const attempts = getDrizzleDatabase().select().from(paymentAttempts).where(eq(paymentAttempts.requestId, "wallee-543-success")).all();
  assert.equal(attempts.length, 1);
});

test("HTTP 542 retries the identical create request with bounded backoff", async () => {
  const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-create-542",
    lines: [line("create-542", 500)],
    table_context: null
  }, 201);
  assert.equal(payment.lifecycle_state, "completed");
  assert.equal(createCalls.get("easytable-wallee-create-542"), 2);
});

test("HTTP 442 is not blindly retried", async () => {
  const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-create-442",
    lines: [line("create-442", 500)],
    table_context: null
  }, 202);
  assert.equal(payment.lifecycle_state, "failed");
  assert.equal(payment.reconciliation_required, false);
  assert.equal(createCalls.get("easytable-wallee-create-442"), 1);
});

test("HTTP 409 after perform resolves through transaction read", async () => {
  const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-perform-409",
    lines: [line("perform-409", 500)],
    table_context: null
  }, 201);
  assert.equal(payment.lifecycle_state, "completed");
  assert.equal(performCalls.get(payment.provider_transaction_id ?? ""), 1);
});

test("pending and undocumented provider states require reconciliation", async () => {
  for (const state of ["pending", "undocumented"]) {
    const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
      request_id: "wallee-" + state,
      lines: [line(state, 500)],
      table_context: null
    }, 202);
    assert.equal(payment.lifecycle_state, "reconciliation_required");
    assert.equal(payment.reconciliation_required, true);
  }
});

for (const declineCode of ["101", "102", "109", "128", "130"]) {
  test("test-acquirer decline " + declineCode + " does not create a sale", async () => {
    const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
      request_id: "wallee-decline-" + declineCode,
      lines: [line("decline-" + declineCode, Number(declineCode) * 100)],
      table_context: null
    }, 202);
    assert.equal(payment.lifecycle_state, "declined");
    assert.equal(payment.status, "FAILED");
    assert.equal(payment.order_id.startsWith("provider_only_"), true);
    assert.equal(getDrizzleDatabase().select().from(orderSnapshots).where(eq(orderSnapshots.orderId, payment.order_id)).all().length, 0);
    assert.equal(getDrizzleDatabase().select().from(salesLedgerEntries).where(eq(salesLedgerEntries.orderId, payment.order_id)).all().length, 0);
  });
}

test("request replay cannot create a second provider transaction", async () => {
  const request = {
    request_id: "wallee-idempotent",
    lines: [line("idempotent", 500)],
    table_context: null
  };
  const first = await post<PaymentResult>("/api/payments/wallee-terminal/start", request, 201);
  const replay = await post<PaymentResult>("/api/payments/wallee-terminal/start", request, 201);
  assert.equal(replay.payment_id, first.payment_id);
  assert.equal(createCalls.get("easytable-wallee-idempotent"), 1);

  const conflicting = await app.inject({ method: "POST", url: "/api/payments/wallee-terminal/start", payload: { request: { ...request, lines: [line("changed", 700)] } } });
  assert.equal(conflicting.statusCode, 500);
  assert.equal(createCalls.get("easytable-wallee-idempotent"), 1);
});

test("refund uses the official V2 refund resource and an idempotent external id", async () => {
  const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-refund-contract",
    lines: [line("refund-contract", 500)],
    table_context: null
  }, 201);
  const first = await app.inject({ method: "POST", url: "/api/payments/" + payment.payment_id + "/refund", payload: { amount: 250 } });
  const replay = await app.inject({ method: "POST", url: "/api/payments/" + payment.payment_id + "/refund", payload: { amount: 250 } });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(refundBodies.at(-1)?.amount, 2.5);
  assert.equal(refundBodies.at(-1)?.transaction, Number(payment.provider_transaction_id));
  assert.equal(refundBodies.at(-1)?.type, "MERCHANT_INITIATED_ONLINE");
  assert.equal(refundBodies.at(-1)?.externalId, refundBodies.at(-2)?.externalId);
});

test("local credentials are encrypted and stale or foreign config is rejected", async () => {
  const active = getDrizzleDatabase().select().from(localWalleeConfig).where(eq(localWalleeConfig.status, "active")).get();
  assert.notEqual(active?.authenticationKeyEncrypted, authenticationKey);
  assert.equal(active?.authenticationKeyEncrypted.includes(authenticationKey), false);
  const encryptionKey = process.env.LOCAL_MASTER_WALLEE_ENCRYPTION_KEY;
  delete process.env.LOCAL_MASTER_WALLEE_ENCRYPTION_KEY;
  assert.equal(getWalleeConfigStatus().enabled, false);
  assert.match(getWalleeConfigStatus().validation_error ?? "", /LOCAL_MASTER_WALLEE_ENCRYPTION_KEY/);
  process.env.LOCAL_MASTER_WALLEE_ENCRYPTION_KEY = encryptionKey;

  relayPayload = paymentConfig(1, true);
  relayPayload.checksum = "stale-checksum";
  const stale = await pullAndActivateWalleeConfig(binding());
  assert.equal(stale.active_config_version, 1);

  relayPayload = { ...paymentConfig(2, true), location_id: "foreign-location" };
  await assert.rejects(() => pullAndActivateWalleeConfig(binding(), 2), /does not belong/);

  relayPayload = paymentConfig(2, true);
  await assert.rejects(() => pullAndActivateWalleeConfig(binding(), 2, "different-checksum"), /unexpected checksum/);
});

test("invalid new terminal config preserves the last active version", async () => {
  relayPayload = paymentConfig(2, true);
  relayPayload.wallee.terminals[0].terminal_id = "99999999";
  await assert.rejects(() => pullAndActivateWalleeConfig(binding(), 2), /validation failed/);
  const status = getWalleeConfigStatus();
  assert.equal(status.active_config_version, 1);
  assert.equal(status.latest_config_version, 2);
  assert.equal(status.latest_status, "rejected");

  relayPayload = paymentConfig(2, true);
  const retried = await pullAndActivateWalleeConfig(binding(), 2, relayPayload.checksum);
  assert.equal(retried.enabled, true);
  assert.equal(retried.active_config_version, 2);
  assert.equal(retried.latest_status, "active");
});

test("partially complimentary Wallee payment charges only paid units and records offered value", async () => {
  const offeredLine = {
    ...line("wallee-partial-complimentary", 500),
    quantity: 2,
    complimentary_quantity: 1,
    complimentary_value: 500,
    line_total: 500
  };
  const command = await startWalleeTerminalPayment({
    request_id: "wallee-partial-complimentary",
    lines: [offeredLine],
    table_context: null,
    actor: {
      user_id: "user_wallee_offer",
      display_name: "Wallee Offer Test",
      role: "STAFF",
      device_id: "pos_wallee_offer",
      terminal_id: null
    }
  });
  const payment = command.payment;
  const ledger = getDrizzleDatabase().select().from(salesLedgerEntries).where(eq(salesLedgerEntries.orderId, payment.order_id)).all();

  assert.equal(payment.amount, 500);
  assert.deepEqual(ledger.map((entry) => entry.entryType).sort(), ["COMPLIMENTARY_RECORDED", "PAYMENT_RECORDED", "SALE_COMPLETED"]);
  assert.equal(ledger.find((entry) => entry.entryType === "SALE_COMPLETED")?.quantity, 1);
  assert.equal(ledger.find((entry) => entry.entryType === "COMPLIMENTARY_RECORDED")?.complimentaryValue, 500);
});

test("HTTP 422 terminal cancellation is an expected cancelled outcome", async () => {
  const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-terminal-cancelled",
    lines: [line("terminal-cancelled", 500)],
    table_context: null
  }, 202);
  assert.equal(payment.lifecycle_state, "cancelled");
  assert.equal(payment.provider_status, "CANCELLED");
  assert.equal(payment.reconciliation_required, false);
  assert.equal(payment.failure_reason, null);
});

test("payment remains available when relay is unavailable after bootstrap", async () => {
  await close(relayServer);
  const payment = await post<PaymentResult>("/api/payments/wallee-terminal/start", {
    request_id: "wallee-relay-independent",
    lines: [line("relay-independent", 500)],
    table_context: null
  }, 201);
  assert.equal(payment.lifecycle_state, "completed");
});

test("newer config versions disable Wallee atomically", async () => {
  relayPayload = paymentConfig(3, false);
  const temporaryRelay = createServer(async (request, response) => handleRelayRequest(request, response));
  await listen(temporaryRelay);
  await pullAndActivateWalleeConfig({ ...binding(), relay_base_url: "http://127.0.0.1:" + (temporaryRelay.address() as AddressInfo).port }, 3);
  await close(temporaryRelay);
  const status = getWalleeConfigStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.latest_config_version, 3);
  assert.equal(status.latest_status, "disabled");
});

function paymentConfig(version: number, enabled: boolean) {
  return {
    config_version: version,
    checksum: "checksum-" + version,
    tenant_id: "tenant_easytable",
    location_id: "location_basilica",
    local_master_instance_id: getLocalMasterIdentity().instance_id,
    wallee: enabled ? {
      enabled: true,
      mode: "CLOUD_TILL_LONG_POLLING",
      profile_id: "profile-1",
      space_id: "30140",
      application_user_id: "12345",
      authentication_key: authenticationKey,
      confirmation_policy: "EXPLICIT",
      receipt_policy: "FETCH_AND_QUEUE_UNPRINTED",
      terminals: [{
        id: "terminal-config-1",
        display_name: "A920 Pro",
        terminal_id: "32581002",
        terminal_identifier: "30000001",
        is_default: true,
        is_active: true
      }]
    } : null
  };
}

function binding() {
  return {
    tenant_id: "tenant_easytable",
    location_id: "location_basilica",
    local_master_instance_id: getLocalMasterIdentity().instance_id,
    relay_base_url: relayBaseUrl,
    relay_token: "relay-token"
  };
}

async function handleRelayRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.url === "/api/local-masters/payment-config" && request.method === "GET") return json(response, 200, relayPayload);
  return json(response, 404, { error: "not found" });
}

async function handleWalleeRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (!request.headers.authorization?.startsWith("Bearer ")) return json(response, 401, { error: "missing auth" });
  if (request.headers.space !== "30140") return json(response, 442, { error: "wrong space" });
  if (request.method === "GET" && url.pathname === "/api/v2.0/payment/terminals/32581002") return json(response, 200, { id: 32581002, state: "ACTIVE" });
  if (request.method === "GET" && url.pathname === "/api/v2.0/payment/terminals/missing") return json(response, 404, { error: "not found" });
  if (request.method === "GET" && url.pathname === "/api/v2.0/payment/terminals") return json(response, 200, { data: [{ id: 32581002, identifier: "89990002303", state: "ACTIVE" }] });
  if (request.method === "POST" && url.pathname === "/api/v2.0/payment/transactions") {
    const body = await readJson(request);
    const reference = String(body.merchantReference);
    const createCount = (createCalls.get(reference) ?? 0) + 1;
    createCalls.set(reference, createCount);
    if (reference.includes("create-442")) return json(response, 442, { error: "invalid transaction payload" });
    if (reference.includes("create-542") && createCount === 1) return json(response, 542, { error: "temporary server error" });
    const id = String(transactionReferences.size + 1000);
    transactionReferences.set(id, reference);
    transactionStates.set(id,
      reference.includes("decline-") ? "DECLINED"
        : reference.includes("undocumented") ? "UNDOCUMENTED_STATE"
          : reference.includes("pending") ? "PENDING"
            : "COMPLETED");
    return json(response, 201, { id, state: "CREATE", merchantReference: reference });
  }
  const confirm = url.pathname.match(/^\/api\/v2\.0\/payment\/transactions\/(\d+)\/confirm$/);
  if (request.method === "POST" && confirm) {
    const count = (confirmCalls.get(confirm[1]) ?? 0) + 1;
    confirmCalls.set(confirm[1], count);
    return json(response, 200, { id: confirm[1], state: "CONFIRMED" });
  }
  const perform = url.pathname.match(/^\/api\/v2\.0\/payment\/terminals\/32581002\/perform-transaction$/);
  if (request.method === "POST" && perform) {
    const id = url.searchParams.get("transactionId") ?? "";
    const count = (performCalls.get(id) ?? 0) + 1;
    performCalls.set(id, count);
    if (transactionReferences.get(id)?.includes("543") && count === 1) return json(response, 543, { error: "long poll timeout" });
    if (transactionReferences.get(id)?.includes("perform-409") && count === 1) return json(response, 409, { error: "transaction version conflict" });
    if (transactionReferences.get(id)?.includes("terminal-cancelled")) return json(response, 422, { message: "Terminal transaction canceled." });
    return json(response, 200, { id, state: transactionStates.get(id) ?? "UNKNOWN" });
  }
  const read = url.pathname.match(/^\/api\/v2\.0\/payment\/transactions\/(\d+)$/);
  if (request.method === "GET" && read) return json(response, 200, { id: read[1], state: transactionStates.get(read[1]) ?? "UNKNOWN" });
  const receipts = url.pathname.match(/^\/api\/v2\.0\/payment\/transactions\/(\d+)\/terminal-receipts$/);
  if (request.method === "GET" && receipts) return json(response, 200, [{
    data: transactionReferences.get(receipts[1])?.includes("receipt-invalid") ? "***" : Buffer.from("receipt").toString("base64"),
    mimeType: "application/pdf",
    printed: false,
    receiptType: "CUSTOMER"
  }]);
  if (request.method === "POST" && url.pathname === "/api/v2.0/payment/refunds") {
    const body = await readJson(request);
    refundBodies.push(body);
    return json(response, 201, { id: 8000, state: "SUCCESSFUL", ...body });
  }
  return json(response, 404, { error: "not found", path: url.pathname });
}

function cashRequest(requestId: string, amount: number) {
  return { request_id: requestId, lines: [line(requestId, amount)], table_context: null, payment_method: "CASH", received_cash: amount, change_given: 0 };
}

function line(id: string, amount: number): BasketLine {
  return { id, product_id: "prod-" + id, product_type: "BASIC", product_name: id, product_category: "Tests", base_price: amount,
    tax_code_id: "vat_81", tax_code_name: "VAT 8.1%", tax_rate_bps: 810, station: "Bar", variants: [], unit_total: amount, quantity: 1, complimentary_quantity: 0, complimentary_value: 0, line_total: amount };
}

async function post<T>(url: string, request: unknown, expected: number) {
  const response = await app.inject({ method: "POST", url, payload: { request } });
  assert.equal(response.statusCode, expected, response.body);
  return response.json<T>();
}

async function readJson(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || "{}");
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}
