import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, test } from "node:test";

import type { FastifyInstance } from "fastify";
import type {
  BasketLine,
  CompletedMockPayment,
  CreatedOrderSnapshot,
  DayClosePreview,
  LocalDevice,
  OpenTableOrderBasket,
  Order,
  PrintJob,
  SavedDayClose,
  TableContext,
  TableLayout
} from "../types.js";
import type { PosOrderSnapshot } from "../store/storeState.js";

process.env.LOCAL_MASTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "easytable-localmaster-test-")), "local-master.sqlite3");

const { buildServer } = await import("../server.js");
const { getDrizzleDatabase } = await import("../db/client.js");
const { localState } = await import("../db/schema.js");
const { pollRelayCommands } = await import("../relayCommandWorker.js");
const {
  payments,
  persistPayments,
  persistPosOrders,
  persistStaffOrders,
  posOrders,
  staffOrders
} = await import("../store/storeState.js");

const app = await buildServer({ logger: false });

after(async () => {
  await app.close();
});

test("local cash payments are idempotent by request_id", async () => {
  const request = paymentRequest("payment_replay_same", "CASH", {
    received_cash: 1500,
    change_given: 300
  });

  const first = await postJson<CompletedMockPayment>("/api/mock-payments/complete", request, 201);
  const second = await postJson<CompletedMockPayment>("/api/mock-payments/complete", request, 201);

  assert.equal(second.payment_id, first.payment_id);
  assert.equal(second.order_id, first.order_id);
  assert.equal(second.lifecycle_state, "completed");

  const openOrders = await getOpenOrders();
  assert.equal(openOrders.filter((order) => order.id === first.order_id).length, 0);
});

test("same payment request_id with a different payload is rejected", async () => {
  const request = paymentRequest("payment_replay_conflict", "CARD_MANUAL");
  const first = await postJson<CompletedMockPayment>("/api/mock-payments/complete", request, 201);
  const conflict = await app.inject({
    method: "POST",
    url: "/api/mock-payments/complete",
    payload: {
      request: {
        ...request,
        lines: [basketLine("conflict-line", 1300)]
      }
    }
  });

  assert.equal(conflict.statusCode, 500);
  assert.equal(conflict.json<{ error: string }>().error, "Internal Server Error");

  const matchingPayments = payments.filter((payment) => payment.requestId === request.request_id);
  assert.equal(matchingPayments.length, 1);
  assert.equal(matchingPayments[0]?.id, first.payment_id);
});

test("cash validation rejects insufficient received cash and wrong change", async () => {
  const insufficient = await app.inject({
    method: "POST",
    url: "/api/mock-payments/complete",
    payload: {
      request: paymentRequest("payment_cash_insufficient", "CASH", {
        received_cash: 1000,
        change_given: 0
      })
    }
  });
  assert.equal(insufficient.statusCode, 500);
  assert.equal(insufficient.json<{ error: string }>().error, "Internal Server Error");

  const wrongChange = await app.inject({
    method: "POST",
    url: "/api/mock-payments/complete",
    payload: {
      request: paymentRequest("payment_cash_wrong_change", "CASH", {
        received_cash: 1500,
        change_given: 200
      })
    }
  });
  assert.equal(wrongChange.statusCode, 500);
  assert.equal(wrongChange.json<{ error: string }>().error, "Internal Server Error");
});

test("order snapshot request_id replay does not create a duplicate order", async () => {
  const beforeJobs = await getPrintJobs();
  const request = {
    request_id: "order_snapshot_replay_same",
    lines: [basketLine("order-replay-line", 1200)],
    table_context: tableContext("table-order-replay", "Tisch Replay")
  };

  const first = await postJson<CreatedOrderSnapshot>("/api/order-snapshots", request, 201);
  const second = await postJson<CreatedOrderSnapshot>("/api/order-snapshots", request, 201);
  const openOrders = await getOpenOrders();
  const afterJobs = await getPrintJobs();

  assert.equal(second.id, first.id);
  assert.equal(openOrders.filter((order) => order.id === first.id).length, 1);
  assert.equal(afterJobs.length, beforeJobs.length);
});

test("staff table orders appear in the POS basket and close when paid from POS", async () => {
  const table = tableContext("table-staff-payment", "Tisch Staff");
  const staffOrder = pushStaffOrder("staff_order_pos_payment", table, [
    { productId: "prod_staff_lemonade", productName: "Staff Lemonade", unitPrice: 700, quantity: 2 }
  ]);

  const openBefore = await getOpenOrders();
  assert.equal(openBefore.some((order) => order.id === staffOrder.id), true);

  const basket = await getOpenTableOrderBasket(table.table_id);
  assert.equal(basket?.order_id, staffOrder.id);
  assert.equal(basket?.lines.length, 1);
  assert.equal(basket?.lines[0]?.product_name, "Staff Lemonade");
  assert.equal(basket?.lines[0]?.quantity, 2);
  assert.equal(basket?.lines[0]?.line_total, 1400);

  const payment = await postJson<CompletedMockPayment>(
    "/api/mock-payments/complete",
    {
      request_id: "payment_staff_order_from_pos",
      lines: basket?.lines ?? [],
      table_context: table,
      payment_method: "CARD_MANUAL"
    },
    201
  );
  const openAfter = await getOpenOrders();
  const basketAfterPayment = await getOpenTableOrderBasket(table.table_id);

  assert.equal(payment.lifecycle_state, "completed");
  assert.equal(payment.order_id, staffOrder.id);
  assert.equal(openAfter.some((order) => order.id === staffOrder.id), false);
  assert.equal(staffOrder.status, "CLOSED");
  assert.equal(basketAfterPayment, null);
});

test("staff table payment lookup does not close an order from another location", async () => {
  const table = tableContext("shared-table-id", "Shared Table");
  const otherLocationTable = { ...table, location_id: "other_location" };
  const otherStaffOrder = pushStaffOrder("staff_order_other_location", otherLocationTable, [
    { productId: "prod_staff_soda", productName: "Other Location Soda", unitPrice: 500, quantity: 1 }
  ]);

  const payment = await postJson<CompletedMockPayment>(
    "/api/mock-payments/complete",
    {
      request_id: "payment_same_table_other_location_guard",
      lines: [basketLine("same-table-current-location", 900)],
      table_context: table,
      payment_method: "CARD_MANUAL"
    },
    201
  );
  const openOrders = await getOpenOrders();

  assert.equal(payment.lifecycle_state, "completed");
  assert.notEqual(payment.order_id, otherStaffOrder.id);
  assert.equal(otherStaffOrder.status, "OPEN");
  assert.equal(openOrders.some((order) => order.id === otherStaffOrder.id), true);
});

test("wallee simulator only closes locally on approved provider result", async () => {
  const approved = await postJson<CompletedMockPayment>(
    "/api/payments/wallee-terminal/start",
    {
      request_id: "wallee_approved",
      terminal_id: "terminal-wallee-ok",
      lines: [basketLine("wallee-ok-line", 1200)],
      table_context: null,
      simulator_outcome: "APPROVED"
    },
    201
  );

  assert.equal(approved.provider, "WALLEE_LTI_SIMULATOR");
  assert.equal(approved.provider_status, "AUTHORIZED");
  assert.equal(approved.lifecycle_state, "completed");

  for (const outcome of ["DECLINED", "CANCELLED", "TIMEOUT"] as const) {
    const failed = await app.inject({
      method: "POST",
      url: "/api/payments/wallee-terminal/start",
      payload: {
        request: {
          request_id: "wallee_" + outcome.toLowerCase(),
          terminal_id: "terminal-wallee-fail",
          lines: [basketLine("wallee-fail-line-" + outcome, 1200)],
          table_context: null,
          simulator_outcome: outcome
        }
      }
    });
    const payment = failed.json<CompletedMockPayment>();

    assert.equal(failed.statusCode, 202);
    assert.equal(payment.provider_status, outcome);
    assert.equal(payment.lifecycle_state, "failed");
    assert.equal(payment.order_id.startsWith("provider_only_"), true);
  }
});

test("receipt printer binding creates one receipt job after local payment completion", async () => {
  const terminalId = "terminal-receipt-sim";
  const printer = await createPrinter("Receipt Simulator", "simulator");
  await bindReceiptPrinter(terminalId, printer.id);

  const payment = await postJson<CompletedMockPayment>(
    "/api/mock-payments/complete",
    {
      ...paymentRequest("payment_receipt_job", "CARD_MANUAL"),
      terminal_id: terminalId
    },
    201
  );
  const jobs = await getPrintJobs();

  assert.equal(payment.lifecycle_state, "completed");
  assert.match(payment.receipt_print_job_id ?? "", /^print_receipt_/);
  assert.equal(jobs.filter((job) => job.id === payment.receipt_print_job_id && job.source === "RECEIPT").length, 1);
});

test("missing receipt printer does not block completed payment", async () => {
  const payment = await postJson<CompletedMockPayment>(
    "/api/mock-payments/complete",
    {
      ...paymentRequest("payment_no_receipt_printer", "CARD_MANUAL"),
      terminal_id: "terminal-without-receipt-printer"
    },
    201
  );

  assert.equal(payment.lifecycle_state, "completed");
  assert.equal(payment.receipt_print_job_id, null);
});

test("print retry request_id replay returns the same job without duplicate jobs", async () => {
  const terminalId = "terminal-retry-browser";
  const printer = await createPrinter("Browser Printer", "browser");
  await bindReceiptPrinter(terminalId, printer.id);

  const payment = await postJson<CompletedMockPayment>(
    "/api/mock-payments/complete",
    {
      ...paymentRequest("payment_retry_job", "CARD_MANUAL"),
      terminal_id: terminalId
    },
    201
  );

  const failedJob = await waitForPrintJob(payment.receipt_print_job_id ?? "", (job) => job.status === "FAILED");
  const beforeCount = (await getPrintJobs()).length;
  const retryRequest = { request_id: "print_retry_replay_same" };
  const first = await postJson<PrintJob>("/api/print-jobs/" + encodeURIComponent(failedJob.id) + "/retry", retryRequest, 200);
  const second = await postJson<PrintJob>("/api/print-jobs/" + encodeURIComponent(failedJob.id) + "/retry", retryRequest, 200);
  const afterCount = (await getPrintJobs()).length;

  assert.equal(second.id, first.id);
  assert.equal(afterCount, beforeCount);
});

test("day close request_id replay returns the same saved close", async () => {
  await postJson<CompletedMockPayment>(
    "/api/mock-payments/complete",
    paymentRequest("payment_day_close_replay", "CASH", {
      received_cash: 1500,
      change_given: 300
    }),
    201
  );
  const businessDate = await postJson<{ business_date: string }>(
    "/api/business-date/current",
    { business_day_cutover_time: "04:00" },
    200
  );
  const request = {
    request_id: "day_close_replay_same",
    business_date: businessDate.business_date,
    business_day_cutover_time: "04:00",
    counted_cash: 1200,
    terminal_id: "terminal-day-close"
  };

  const first = await postJson<SavedDayClose>("/api/day-close", request, 201);
  const second = await postJson<SavedDayClose>("/api/day-close", request, 201);

  assert.deepEqual(second, first);
});

test("day close preview counts legacy completed and lifecycle completed payments", async () => {
  const businessDate = await postJson<{ business_date: string }>(
    "/api/business-date/current",
    { business_day_cutover_time: "04:00" },
    200
  );
  const before = await dayClosePreview(businessDate.business_date);
  const now = Date.now();
  const legacyOrderId = "legacy_order_for_day_close";

  posOrders.push({
    id: legacyOrderId,
    order_number: "LEGACY-1",
    table_context: null,
    lines: [basketLine("legacy-line", 555)],
    subtotal: 555,
    tax_total: 40,
    total: 555,
    status: "CLOSED",
    payment_status: "PAID",
    created_at: now,
    updated_at: now,
    closed_at: now
  });
  payments.push({
    id: "legacy_payment_for_day_close",
    orderId: legacyOrderId,
    orderNumber: "LEGACY-1",
    amount: 555,
    method: "CARD_MANUAL",
    status: "COMPLETED",
    createdAt: now
  });
  persistPosOrders();
  persistPayments();

  await postJson<CompletedMockPayment>(
    "/api/mock-payments/complete",
    paymentRequest("payment_lifecycle_day_close", "CARD_MANUAL"),
    201
  );
  const after = await dayClosePreview(businessDate.business_date);

  assert.equal(after.expected_card - before.expected_card, 1755);
  assert.equal(after.expected_total - before.expected_total, 1755);
});

test("table layout is seeded into local SQLite and served through legacy endpoint", async () => {
  const response = await app.inject({ method: "GET", url: "/api/table-layout" });
  const layout = response.json<TableLayout>();

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(layout.location.id, "loc_basilica_main");
  assert.equal(layout.floors.length >= 2, true);
  assert.equal(layout.floors.some((floor) => floor.areas.some((area) => area.tables.length > 0)), true);
});

test("owner location layout CRUD updates persisted table layout", async () => {
  const locations = await getOwnerLocations();
  const locationId = locations[0]?.id ?? "";

  assert.equal(locationId, "loc_basilica_main");

  const floor = await writeDirect<{ id: string; name: string; sort_order: number }>(
    "POST",
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/floors",
    { name: "Terrasse Test", sort_order: 90 },
    201
  );
  const renamedFloor = await writeDirect<{ id: string; name: string; sort_order: number }>(
    "PATCH",
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/floors/" + encodeURIComponent(floor.id),
    { name: "Terrasse Test 2", sort_order: 91 },
    200
  );
  const area = await writeDirect<{ id: string; name: string; sort_order: number }>(
    "POST",
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/areas",
    { floor_id: floor.id, name: "Aussen", sort_order: 10 },
    201
  );
  const table = await writeDirect<{ id: string; name: string; seats: number; sort_order: number }>(
    "POST",
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/tables",
    { area_id: area.id, name: "99", seats: 4, sort_order: 10 },
    201
  );
  const renamedTable = await writeDirect<{ id: string; name: string; seats: number; sort_order: number }>(
    "PATCH",
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/tables/" + encodeURIComponent(table.id),
    { name: "99A", seats: 6 },
    200
  );
  const layout = await getOwnerTableLayout(locationId);

  assert.equal(renamedFloor.name, "Terrasse Test 2");
  assert.equal(renamedTable.name, "99A");
  assert.equal(renamedTable.seats, 6);
  assert.equal(layout.floors.some((entry) => entry.id === floor.id), true);
  assert.equal(layout.floors.some((entry) => entry.areas.some((item) => item.id === area.id)), true);
  assert.equal(layout.floors.some((entry) => entry.areas.some((item) => item.tables.some((candidate) => candidate.id === table.id))), true);

  await writeDirect("DELETE", "/api/owner/locations/" + encodeURIComponent(locationId) + "/tables/" + encodeURIComponent(table.id), undefined, 204);
  await writeDirect("DELETE", "/api/owner/locations/" + encodeURIComponent(locationId) + "/areas/" + encodeURIComponent(area.id), undefined, 204);
  await writeDirect("DELETE", "/api/owner/locations/" + encodeURIComponent(locationId) + "/floors/" + encodeURIComponent(floor.id), undefined, 204);
});

test("owner layout mutations reject foreign locations", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/owner/locations/other_location/floors",
    payload: { name: "Wrong Location" }
  });

  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.json<{ error: string }>().error, "Location is not managed by this Local Master.");
});

test("owner table delete rejects tables with open orders", async () => {
  const locations = await getOwnerLocations();
  const locationId = locations[0]?.id ?? "";
  const layout = await getOwnerTableLayout(locationId);
  const floor = layout.floors[0];
  const area = floor?.areas[0];
  const table = area?.tables[0];

  assert.ok(floor);
  assert.ok(area);
  assert.ok(table);

  pushStaffOrder("staff_order_table_delete_guard", {
    tenant_id: layout.tenant.id,
    location_id: layout.location.id,
    floor_id: floor.id,
    area_id: area.id,
    table_id: table.id,
    table_name: table.name,
    area_name: area.name,
    floor_name: floor.name,
    seats: table.seats
  }, [
    { productId: "prod_delete_guard", productName: "Delete Guard", unitPrice: 500, quantity: 1 }
  ]);

  const response = await app.inject({
    method: "DELETE",
    url: "/api/owner/locations/" + encodeURIComponent(locationId) + "/tables/" + encodeURIComponent(table.id)
  });

  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json<{ error: string }>().error, "Table has an open order.");
});

test("relay command polling tolerates unreachable relay", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const now = Date.now();

  getDrizzleDatabase()
    .insert(localState)
    .values({
      key: "localMaster.cloudBinding",
      valueJson: JSON.stringify({
        status: "PAIRED",
        tenant_id: "tenant_basilica",
        location_id: "loc_basilica_main",
        local_master_instance_id: "lm_test_unreachable_relay",
        relay_base_url: "http://relay-unreachable.test",
        paired_at: new Date(now).toISOString(),
        last_verified_at: new Date(now).toISOString(),
        invalid_reason: null,
        bootstrap_completed_at: new Date(now).toISOString(),
        bootstrap_error: null,
        relay_token: "relay_token_test"
      }),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: localState.key,
      set: {
        valueJson: JSON.stringify({
          status: "PAIRED",
          tenant_id: "tenant_basilica",
          location_id: "loc_basilica_main",
          local_master_instance_id: "lm_test_unreachable_relay",
          relay_base_url: "http://relay-unreachable.test",
          paired_at: new Date(now).toISOString(),
          last_verified_at: new Date(now).toISOString(),
          invalid_reason: null,
          bootstrap_completed_at: new Date(now).toISOString(),
          bootstrap_error: null,
          relay_token: "relay_token_test"
        }),
        updatedAt: now
      }
    })
    .run();

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  console.warn = () => undefined;

  try {
    await pollRelayCommands();
    await pollRelayCommands();
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("relay staff order ACK includes fresh operations snapshot", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const now = Date.now();
  const commandId = "relay_staff_order_ack_snapshot";
  const table: TableContext = {
    tenant_id: "tenant_basilica",
    location_id: "loc_basilica_main",
    floor_id: "floor_basilica_eg",
    area_id: "area_basilica_bar",
    table_id: "table_basilica_bar_1",
    table_name: "1",
    area_name: "Bar",
    floor_name: "EG",
    seats: 2
  };
  let ackBody: unknown = null;

  writeCloudBindingForTest({
    localMasterInstanceId: "lm_test_ack_snapshot",
    now,
    relayBaseUrl: "http://relay.test",
    relayToken: "relay_token_ack_snapshot"
  });

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/local-masters/commands/pending")) {
      return jsonResponse({
        data: [{
          command_id: commandId,
          tenant_id: "tenant_basilica",
          location_id: "loc_basilica_main",
          local_master_instance_id: "lm_test_ack_snapshot",
          type: "STAFF_ORDER_SNAPSHOT_CREATE",
          status: "delivered",
          payload: {
            request_id: "relay_staff_order_ack_snapshot_request",
            lines: [basketLine("relay-ack-snapshot-line", 900)],
            table_context: table
          }
        }]
      });
    }

    if (url.endsWith("/api/local-masters/operations")) {
      return jsonResponse({ ok: true });
    }

    if (url.endsWith("/api/local-masters/commands/" + commandId + "/ack")) {
      ackBody = JSON.parse(String(init?.body ?? "{}"));
      return jsonResponse({ ok: true });
    }

    return new Response("Unexpected URL " + url, { status: 500 });
  };
  console.warn = () => undefined;

  try {
    await pollRelayCommands();
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }

  const capturedAck = ackBody as {
    status?: string;
    result?: { operations_snapshot?: { open_table_baskets?: Array<{ table_id: string }> } };
  };

  assert.equal(capturedAck.status, "accepted");
  assert.equal(
    capturedAck.result?.operations_snapshot?.open_table_baskets?.some((entry) => entry.table_id === table.table_id),
    true
  );
});

async function postJson<T>(url: string, request: unknown, expectedStatus: number): Promise<T> {
  const response = await app.inject({
    method: "POST",
    url,
    payload: { request }
  });

  assert.equal(response.statusCode, expectedStatus, response.body);
  return response.json<T>();
}

function writeCloudBindingForTest({
  localMasterInstanceId,
  now,
  relayBaseUrl,
  relayToken
}: {
  localMasterInstanceId: string;
  now: number;
  relayBaseUrl: string;
  relayToken: string;
}) {
  getDrizzleDatabase()
    .insert(localState)
    .values({
      key: "localMaster.cloudBinding",
      valueJson: JSON.stringify({
        status: "PAIRED",
        tenant_id: "tenant_basilica",
        location_id: "loc_basilica_main",
        local_master_instance_id: localMasterInstanceId,
        relay_base_url: relayBaseUrl,
        paired_at: new Date(now).toISOString(),
        last_verified_at: new Date(now).toISOString(),
        invalid_reason: null,
        bootstrap_completed_at: new Date(now).toISOString(),
        bootstrap_error: null,
        relay_token: relayToken
      }),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: localState.key,
      set: {
        valueJson: JSON.stringify({
          status: "PAIRED",
          tenant_id: "tenant_basilica",
          location_id: "loc_basilica_main",
          local_master_instance_id: localMasterInstanceId,
          relay_base_url: relayBaseUrl,
          paired_at: new Date(now).toISOString(),
          last_verified_at: new Date(now).toISOString(),
          invalid_reason: null,
          bootstrap_completed_at: new Date(now).toISOString(),
          bootstrap_error: null,
          relay_token: relayToken
        }),
        updatedAt: now
      }
    })
    .run();
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function writeDirect<T>(method: "POST" | "PATCH" | "DELETE", url: string, payload: object | undefined, expectedStatus: number): Promise<T> {
  const response = payload === undefined
    ? await app.inject({ method, url })
    : await app.inject({ method, url, payload });

  assert.equal(response.statusCode, expectedStatus, response.body);
  return response.statusCode === 204 ? (undefined as T) : response.json<T>();
}

async function getOwnerLocations() {
  const response = await app.inject({ method: "GET", url: "/api/owner/locations" });

  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ data: Array<{ id: string; tenant_id: string; name: string }> }>().data;
}

async function getOwnerTableLayout(locationId: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/owner/locations/" + encodeURIComponent(locationId) + "/table-layout"
  });

  assert.equal(response.statusCode, 200, response.body);
  return response.json<TableLayout>();
}

async function getOpenOrders() {
  const response = await app.inject({ method: "GET", url: "/api/orders/open" });

  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ data: Array<PosOrderSnapshot | Order> }>().data;
}

async function getOpenTableOrderBasket(tableId: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/tables/" + encodeURIComponent(tableId) + "/open-basket"
  });

  assert.equal(response.statusCode, 200, response.body);
  return response.json<OpenTableOrderBasket | null>();
}

async function getPrintJobs() {
  const response = await app.inject({ method: "GET", url: "/api/print-jobs" });

  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ data: PrintJob[] }>().data;
}

async function createPrinter(name: string, provider: "browser" | "simulator") {
  return postJson<LocalDevice>(
    "/api/local-devices",
    {
      name,
      type: "PRINTER",
      provider
    },
    201
  );
}

async function bindReceiptPrinter(terminalId: string, printerId: string) {
  await postJson(
    "/api/pos-device-bindings/" + encodeURIComponent(terminalId),
    {
      receipt_printer_device_id: printerId
    },
    200
  );
}

async function dayClosePreview(businessDate: string) {
  return postJson<DayClosePreview>(
    "/api/day-close/preview",
    {
      business_date: businessDate,
      business_day_cutover_time: "04:00"
    },
    200
  );
}

async function waitForPrintJob(jobId: string, predicate: (job: PrintJob) => boolean) {
  assert.notEqual(jobId, "");

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = (await getPrintJobs()).find((entry) => entry.id === jobId);

    if (job && predicate(job)) {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.fail("Timed out waiting for print job " + jobId);
}

function paymentRequest(
  requestId: string,
  paymentMethod: "CASH" | "CARD_MANUAL",
  cash: { received_cash?: number; change_given?: number } = {}
) {
  return {
    request_id: requestId,
    lines: [basketLine(requestId + "_line", 1200)],
    table_context: null,
    payment_method: paymentMethod,
    ...cash
  };
}

function basketLine(id: string, amount: number): BasketLine {
  return {
    id,
    product_id: "prod_" + id,
    product_type: "BASIC",
    product_name: "Test Product " + id,
    product_category: "Tests",
    base_price: amount,
    tax_code_id: "vat_81",
    tax_code_name: "VAT 8.1%",
    tax_rate_bps: 810,
    station: "Bar",
    variants: [],
    unit_total: amount,
    quantity: 1,
    line_total: amount
  };
}

function pushStaffOrder(
  id: string,
  table: TableContext,
  items: Array<{ productId: string; productName: string; unitPrice: number; quantity: number }>
) {
  const now = Date.now();
  const order: Order = {
    id,
    orderNumber: "S-" + id,
    source: "STAFF",
    deviceId: "staff-test-device",
    locationId: table.location_id,
    tableId: table.table_id,
    tableName: table.table_name,
    guestCount: table.seats ?? 1,
    status: "OPEN",
    total: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    items: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      productName: item.productName,
      unitPrice: item.unitPrice,
      totalPrice: item.unitPrice * item.quantity
    })),
    createdAt: now,
    closedAt: null
  };

  staffOrders.push(order);
  persistStaffOrders();
  return order;
}

function tableContext(tableId: string, tableName: string): TableContext {
  return {
    tenant_id: "tenant_test",
    location_id: "location_test",
    floor_id: "floor_test",
    area_id: "area_main",
    table_id: tableId,
    table_name: tableName,
    area_name: "Main",
    floor_name: "Ground",
    seats: 2
  };
}
