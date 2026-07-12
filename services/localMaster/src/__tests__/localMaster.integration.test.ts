import { mkdtempSync } from "node:fs";
import { pbkdf2Sync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, test } from "node:test";

import type { FastifyInstance } from "fastify";
import type {
  BasketLine,
  PaymentResult,
  CreatedOrderSnapshot,
  DayClosePreview,
  LocalDevice,
  OpenTableOrderBasket,
  Order,
  OrderSnapshotListItem,
  OrderSnapshotResponse,
  PrintJob,
  SalesReport,
  SavedDayClose,
  StornoResult,
  TableContext,
  TableLayout
} from "../types.js";
import type { PosOrderSnapshot } from "../store/storeState.js";

process.env.NODE_ENV = "test";
process.env.LOCAL_MASTER_DB_PATH = join(mkdtempSync(join(tmpdir(), "easytable-localmaster-test-")), "local-master.sqlite3");
process.env.LOCAL_MASTER_DISABLE_POWERSYNC = "1";
process.env.LOCAL_MASTER_DISABLE_NATS = "1";

const { buildServer } = await import("../server.js");
const { getDrizzleDatabase } = await import("../db/client.js");
const {
  commandInbox: commandInboxTable,
  layoutAreas,
  layoutFloors,
  layoutTables,
  localOutbox: localOutboxTable,
  localState,
  orderSnapshotLines: orderSnapshotLinesTable,
  orderSnapshots: orderSnapshotsTable,
  salesLedgerEntries: salesLedgerEntriesTable
} = await import("../db/schema.js");
const { pollRelayCommands } = await import("../relayCommandWorker.js");
const { getCloudBinding, retryCloudBootstrap } = await import("../cloudBinding.js");
const { loadLocalSiteConfig } = await import("../store/localSiteStore.js");
const { eq } = await import("drizzle-orm");
const {
  payments,
  orderSnapshots,
  persistPayments,
  persistPosOrders,
  persistStaffOrders,
  posOrders,
  salesLedgerEntries,
  staffOrders
} = await import("../store/storeState.js");
const { readState } = await import("../statePersistence.js");

const app = await buildServer({ logger: false });

after(async () => {
  await app.close();
});

test("fresh local SQLite starts without table-plan or catalog defaults", async () => {
  const layoutResponse = await app.inject({ method: "GET", url: "/api/table-layout" });
  const stationResponse = await app.inject({ method: "GET", url: "/api/catalog/output-stations" });
  const variantResponse = await app.inject({ method: "GET", url: "/api/catalog/product-variant-groups" });

  assert.equal(layoutResponse.statusCode, 200, layoutResponse.body);
  assert.deepEqual(layoutResponse.json<TableLayout>().floors, []);
  assert.deepEqual(stationResponse.json<{ data: unknown[] }>().data, []);
  assert.deepEqual(variantResponse.json<{ data: unknown[] }>().data, []);

  seedTestTableLayout();
});

test("local cash payments are idempotent by request_id", async () => {
  const request = paymentRequest("payment_replay_same", "CASH", {
    received_cash: 1500,
    change_given: 300
  });

  const first = await postJson<PaymentResult>("/api/payments/cash/complete", request, 201);
  const second = await postJson<PaymentResult>("/api/payments/cash/complete", request, 201);

  assert.equal(second.payment_id, first.payment_id);
  assert.equal(second.order_id, first.order_id);
  assert.equal(second.lifecycle_state, "completed");

  const openOrders = await getOpenOrders();
  assert.equal(openOrders.filter((order) => order.id === first.order_id).length, 0);
});

test("same payment request_id with a different payload is rejected", async () => {
  const request = paymentRequest("payment_replay_conflict", "CASH");
  const first = await postJson<PaymentResult>("/api/payments/cash/complete", request, 201);
  const conflict = await app.inject({
    method: "POST",
    url: "/api/payments/cash/complete",
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
    url: "/api/payments/cash/complete",
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
    url: "/api/payments/cash/complete",
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
    table_context: tableContext("table_basilica_fumoir_2", "2")
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
  const table = tableContext("table_basilica_fumoir_3", "3");
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

  const payment = await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    {
      request_id: "payment_staff_order_from_pos",
      lines: basket?.lines ?? [],
      table_context: table,
      payment_method: "CASH"
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
  const table = tableContext("table_basilica_og_30", "30");
  const otherLocationTable = { ...table, location_id: "other_location" };
  const otherStaffOrder = pushStaffOrder("staff_order_other_location", otherLocationTable, [
    { productId: "prod_staff_soda", productName: "Other Location Soda", unitPrice: 500, quantity: 1 }
  ]);

  const payment = await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    {
      request_id: "payment_same_table_other_location_guard",
      lines: [basketLine("same-table-current-location", 900)],
      table_context: table,
      payment_method: "CASH"
    },
    201
  );
  const openOrders = await getOpenOrders();

  assert.equal(payment.lifecycle_state, "completed");
  assert.notEqual(payment.order_id, otherStaffOrder.id);
  assert.equal(otherStaffOrder.status, "OPEN");
  assert.equal(openOrders.some((order) => order.id === otherStaffOrder.id), true);
});

test("completed cash payment creates immutable order snapshot and ledger entries once", async () => {
  const beforeSnapshots = orderSnapshots.length;
  const beforeLedger = salesLedgerEntries.length;
  const request = paymentRequest("payment_snapshot_cash", "CASH", {
    received_cash: 1500,
    change_given: 300
  });

  const payment = await postJson<PaymentResult>("/api/payments/cash/complete", request, 201);
  const replay = await postJson<PaymentResult>("/api/payments/cash/complete", request, 201);
  const snapshot = await getOrderSnapshot(payment.order_id);
  const saleEntries = salesLedgerEntries.filter((entry) => entry.order_id === payment.order_id && entry.entry_type === "SALE_COMPLETED");
  const paymentEntries = salesLedgerEntries.filter((entry) => entry.order_id === payment.order_id && entry.entry_type === "PAYMENT_RECORDED");
  const outbox = readState<Array<{ event_type: string; aggregate_id: string }>>("localOutbox", []);
  const sqlSnapshot = getDrizzleDatabase()
    .select()
    .from(orderSnapshotsTable)
    .where(eq(orderSnapshotsTable.orderId, payment.order_id))
    .get();
  const sqlLines = getDrizzleDatabase()
    .select()
    .from(orderSnapshotLinesTable)
    .where(eq(orderSnapshotLinesTable.orderId, payment.order_id))
    .all();
  const sqlLedger = getDrizzleDatabase()
    .select()
    .from(salesLedgerEntriesTable)
    .where(eq(salesLedgerEntriesTable.orderId, payment.order_id))
    .all();
  const sqlOutbox = getDrizzleDatabase()
    .select()
    .from(localOutboxTable)
    .where(eq(localOutboxTable.aggregateId, payment.order_id))
    .all();
  const sqlCommand = getDrizzleDatabase()
    .select()
    .from(commandInboxTable)
    .where(eq(commandInboxTable.requestId, request.request_id))
    .get();

  assert.equal(replay.payment_id, payment.payment_id);
  assert.equal(orderSnapshots.length - beforeSnapshots, 1);
  assert.equal(salesLedgerEntries.length - beforeLedger, 2);
  assert.equal(snapshot.order_id, payment.order_id);
  assert.equal(snapshot.lines[0]?.product_name, request.lines[0]?.product_name);
  assert.equal(snapshot.lines[0]?.tax_rate_bps, 810);
  assert.equal(snapshot.payment.provider, "LOCAL");
  assert.equal(snapshot.payment.method, "CASH");
  assert.equal(saleEntries.length, 1);
  assert.equal(paymentEntries.length, 1);
  assert.equal(saleEntries[0]?.gross_amount, 1200);
  assert.equal(paymentEntries[0]?.gross_amount, 1200);
  assert.equal(sqlSnapshot?.orderId, payment.order_id);
  assert.equal(sqlLines.length, 1);
  assert.equal(sqlLedger.length, 2);
  assert.equal(sqlOutbox.some((entry) => entry.eventType === "ORDER_SNAPSHOT_RECORDED"), true);
  assert.equal(sqlCommand?.status, "COMPLETED");
  assert.equal(outbox.some((entry) => entry.event_type === "ORDER_SNAPSHOT_RECORDED" && entry.aggregate_id === payment.order_id), true);
  assert.equal(outbox.some((entry) => entry.event_type === "SALES_LEDGER_UPDATED" && entry.aggregate_id === payment.order_id), true);
});

test("order snapshot reporting list filters paid snapshots and exposes storno state", async () => {
  const paid = await postJson<PaymentResult>("/api/payments/cash/complete", paymentRequest("snapshot_list_paid", "CASH", {
    lines: [basketLine("snapshot-list-line", 2400, 2)],
    terminal_id: "terminal-list-a",
    received_cash: 4800,
    change_given: 0
  }), 201);
  await postJson<StornoResult>("/api/orders/" + paid.order_id + "/stornos", {
    request_id: "snapshot_list_partial_storno",
    kind: "PARTIAL",
    reason: "Test partial",
    terminal_id: "terminal-list-a",
    lines: [{ line_id: "snapshot-list-line", quantity: 1 }]
  }, 201);

  await postJson<PaymentResult>("/api/payments/cash/complete", paymentRequest("snapshot_list_other", "CASH", {
    terminal_id: "terminal-list-b"
  }), 201);

  const matching = await getJson<OrderSnapshotListItem[]>("/api/reporting/order-snapshots?query=" + encodeURIComponent(paid.order_number));
  assert.equal(matching.length, 1);
  assert.equal(matching[0]?.order_id, paid.order_id);
  assert.equal(matching[0]?.storno_state, "PARTIAL");
  assert.equal(matching[0]?.refunded_total, 2400);
  assert.equal(matching[0]?.remaining_total, 2400);

  const terminalFiltered = await getJson<OrderSnapshotListItem[]>("/api/reporting/order-snapshots?terminal_id=terminal-list-a&storno_state=PARTIAL");
  assert.ok(terminalFiltered.some((snapshot) => snapshot.order_id === paid.order_id));
  assert.ok(terminalFiltered.every((snapshot) => snapshot.terminal_id === "terminal-list-a" || snapshot.payment.terminal_id === "terminal-list-a"));

  const paymentFiltered = await getJson<OrderSnapshotListItem[]>("/api/reporting/order-snapshots?payment_method=CASH");
  assert.ok(paymentFiltered.some((snapshot) => snapshot.order_id === paid.order_id));
  assert.ok(paymentFiltered.every((snapshot) => snapshot.payment.method === "CASH"));
});

test("sales reporting uses ledger entries and excludes unpaid records", async () => {
  const businessDate = await postJson<{ business_date: string }>(
    "/api/business-date/current",
    { business_day_cutover_time: "04:00" },
    200
  );
  const before = await salesReport(businessDate.business_date);
  await postJson<CreatedOrderSnapshot>(
    "/api/order-snapshots",
    {
      request_id: "reporting_unpaid_order",
      lines: [basketLine("reporting-unpaid-line", 999)],
      table_context: tableContext("table_basilica_fumoir_2", "2")
    },
    201
  );
  await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    {
      request_id: "reporting_card_sale",
      lines: [basketLine("reporting-card-sale-line", 2100)],
      table_context: null,
      payment_method: "CASH"
    },
    201
  );
  const after = await salesReport(businessDate.business_date);

  assert.equal(after.gross_total - before.gross_total, 2100);
  assert.equal(after.payment_totals.cash - before.payment_totals.cash, 2100);
  assert.equal(after.entries.some((entry) => entry.request_id === "reporting_unpaid_order"), false);
});

test("partial storno creates negative ledger entries and rejects over-storno", async () => {
  const payment = await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    {
      request_id: "storno_partial_payment",
      lines: [basketLine("storno-partial-line", 500, 3)],
      table_context: null,
      payment_method: "CASH"
    },
    201
  );
  const first = await createStorno(payment.order_id, {
    request_id: "storno_partial_one",
    kind: "PARTIAL",
    reason: "Gast retour",
    terminal_id: "terminal-storno",
    lines: [{ line_id: "storno-partial-line", quantity: 1 }]
  }, 201);
  const replay = await createStorno(payment.order_id, {
    request_id: "storno_partial_one",
    kind: "PARTIAL",
    reason: "Gast retour",
    terminal_id: "terminal-storno",
    lines: [{ line_id: "storno-partial-line", quantity: 1 }]
  }, 201);
  const over = await app.inject({
    method: "POST",
    url: "/api/orders/" + encodeURIComponent(payment.order_id) + "/stornos",
    payload: {
      request: {
        request_id: "storno_partial_over",
        kind: "PARTIAL",
        reason: "Zu viel",
        terminal_id: "terminal-storno",
        lines: [{ line_id: "storno-partial-line", quantity: 3 }]
      }
    }
  });
  const correction = first.ledger_entries.find((entry) => entry.entry_type === "ORDER_PARTIALLY_VOIDED");

  assert.equal(replay.refunded_amount, first.refunded_amount);
  assert.equal(first.refunded_amount, 500);
  assert.equal(first.remaining_amount, 1000);
  assert.equal(correction?.quantity, -1);
  assert.equal(correction?.gross_amount, -500);
  assert.equal(over.statusCode, 500);
});

test("full storno after partial only reverses remaining quantities and rejects when empty", async () => {
  const payment = await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    {
      request_id: "storno_full_after_partial_payment",
      lines: [basketLine("storno-full-after-partial-line", 400, 3)],
      table_context: null,
      payment_method: "CASH",
      received_cash: 1500,
      change_given: 300
    },
    201
  );
  await createStorno(payment.order_id, {
    request_id: "storno_full_partial_first",
    kind: "PARTIAL",
    reason: "Ein Artikel retour",
    terminal_id: "terminal-storno-full",
    lines: [{ line_id: "storno-full-after-partial-line", quantity: 1 }]
  }, 201);
  const full = await createStorno(payment.order_id, {
    request_id: "storno_full_remaining",
    kind: "FULL",
    reason: "Rest retour",
    terminal_id: "terminal-storno-full"
  }, 201);
  const empty = await app.inject({
    method: "POST",
    url: "/api/orders/" + encodeURIComponent(payment.order_id) + "/stornos",
    payload: {
      request: {
        request_id: "storno_full_empty",
        kind: "FULL",
        reason: "Nochmal",
        terminal_id: "terminal-storno-full"
      }
    }
  });

  assert.equal(full.refunded_amount, 800);
  assert.equal(full.remaining_amount, 0);
  assert.equal(full.ledger_entries.find((entry) => entry.entry_type === "ORDER_VOIDED")?.quantity, -2);
  assert.equal(empty.statusCode, 500);
});

test("storno validation rejects unknown, zero, and conflicting partial requests", async () => {
  const payment = await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    {
      request_id: "storno_validation_payment",
      lines: [basketLine("storno-validation-line", 700, 2)],
      table_context: null,
      payment_method: "CASH"
    },
    201
  );
  const zero = await app.inject({
    method: "POST",
    url: "/api/orders/" + encodeURIComponent(payment.order_id) + "/stornos",
    payload: { request: { request_id: "storno_zero", kind: "PARTIAL", reason: "Zero", lines: [{ line_id: "storno-validation-line", quantity: 0 }] } }
  });
  const unknown = await app.inject({
    method: "POST",
    url: "/api/orders/" + encodeURIComponent(payment.order_id) + "/stornos",
    payload: { request: { request_id: "storno_unknown", kind: "PARTIAL", reason: "Unknown", lines: [{ line_id: "missing", quantity: 1 }] } }
  });
  await createStorno(payment.order_id, {
    request_id: "storno_conflict_same_id",
    kind: "PARTIAL",
    reason: "One",
    lines: [{ line_id: "storno-validation-line", quantity: 1 }]
  }, 201);
  const conflict = await app.inject({
    method: "POST",
    url: "/api/orders/" + encodeURIComponent(payment.order_id) + "/stornos",
    payload: { request: { request_id: "storno_conflict_same_id", kind: "PARTIAL", reason: "Changed", lines: [{ line_id: "storno-validation-line", quantity: 1 }] } }
  });

  assert.equal(zero.statusCode, 500);
  assert.equal(unknown.statusCode, 500);
  assert.equal(conflict.statusCode, 500);
});

test("day close preview uses ledger corrections and saved close is immutable after storno", async () => {
  const businessDate = await postJson<{ business_date: string }>(
    "/api/business-date/current",
    { business_day_cutover_time: "04:00" },
    200
  );
  const payment = await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    {
      request_id: "storno_day_close_payment",
      lines: [basketLine("storno-day-close-line", 1000, 2)],
      table_context: null,
      payment_method: "CASH",
      received_cash: 2500,
      change_given: 500
    },
    201
  );
  const beforeClose = await dayClosePreview(businessDate.business_date);
  const saved = await postJson<SavedDayClose>(
    "/api/day-close",
    {
      request_id: "day_close_before_late_storno",
      business_date: businessDate.business_date,
      business_day_cutover_time: "04:00",
      counted_cash: beforeClose.expected_cash,
      terminal_id: "terminal-day-close-storno"
    },
    201
  );
  await createStorno(payment.order_id, {
    request_id: "storno_after_saved_day_close",
    kind: "PARTIAL",
    reason: "Nach Abschluss retour",
    terminal_id: "terminal-day-close-storno",
    lines: [{ line_id: "storno-day-close-line", quantity: 1 }]
  }, 201);
  const afterStorno = await dayClosePreview(businessDate.business_date);

  assert.equal(afterStorno.existing_close?.counted_cash, saved.counted_cash);
  assert.equal(afterStorno.existing_close?.created_at, saved.created_at);
  assert.equal(beforeClose.expected_cash - afterStorno.expected_cash, 1000);
  assert.equal(afterStorno.product_sales.some((entry) => entry.product_id === "prod_storno-day-close-line" && entry.quantity >= 1), true);
});

test("receipt printer binding creates one receipt job after local payment completion", async () => {
  const terminalId = "terminal-receipt-sim";
  const printer = await createPrinter("Receipt Browser", "browser");
  await bindReceiptPrinter(terminalId, printer.id);

  const payment = await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    {
      ...paymentRequest("payment_receipt_job", "CASH"),
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
  const payment = await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    {
      ...paymentRequest("payment_no_receipt_printer", "CASH"),
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

  const payment = await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    {
      ...paymentRequest("payment_retry_job", "CASH"),
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
  await postJson<PaymentResult>(
    "/api/payments/cash/complete",
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

test("day close preview ignores legacy payments without ledger and counts lifecycle completed ledger payments", async () => {
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
    method: "CASH",
    status: "COMPLETED",
    createdAt: now
  });
  persistPosOrders();
  persistPayments();

  await postJson<PaymentResult>(
    "/api/payments/cash/complete",
    paymentRequest("payment_lifecycle_day_close", "CASH"),
    201
  );
  const after = await dayClosePreview(businessDate.business_date);

  assert.equal(after.expected_cash - before.expected_cash, 1200);
  assert.equal(after.expected_total - before.expected_total, 1200);
});

test("explicitly configured table layout is served through legacy endpoint", async () => {
  const response = await app.inject({ method: "GET", url: "/api/table-layout" });
  const layout = response.json<TableLayout>();

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(layout.location.id, "loc_basilica_main");
  assert.equal(layout.floors.length, 2);
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

test("rejected Wallee config does not invalidate successful core bootstrap", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const site = loadLocalSiteConfig();
  const now = Date.now();
  writeCloudBindingForTest({ localMasterInstanceId: "lm_wallee_optional", now, relayBaseUrl: "http://relay-bootstrap.test", relayToken: "relay_token_wallee_optional" });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/local-masters/bootstrap")) return jsonResponse({
      tenant: { id: site.tenant.id, name: site.tenant.name, slug: "test", email: null, phone: null, website: null, status: "ACTIVE", created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() },
      location: { id: site.location.id, tenant_id: site.tenant.id, name: site.location.name, slug: "test", address: null, local_master_instance_id: "lm_wallee_optional", service_mode: site.service_mode, status: "ACTIVE", created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() },
      service_mode: site.service_mode, output_stations: [], users: [], bootstrapped_at: new Date(now).toISOString(),
    });
    if (url.endsWith("/api/local-masters/payment-config")) return jsonResponse({ error: "invalid Wallee config" }, 500);
    return jsonResponse({ ok: true });
  };
  console.warn = () => undefined;
  try {
    await retryCloudBootstrap();
    assert.equal(getCloudBinding().status, "PAIRED");
    assert.equal(getCloudBinding().bootstrap_error, null);
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

test("relay command for a different LocalMaster binding is ACKed as failed", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const now = Date.now();
  const commandId = "relay_wrong_binding_command";
  let ackBody: unknown = null;

  writeCloudBindingForTest({
    localMasterInstanceId: "lm_expected_binding",
    now,
    relayBaseUrl: "http://relay.test",
    relayToken: "relay_token_wrong_binding"
  });

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/local-masters/commands/pending")) {
      return jsonResponse({
        data: [{
          command_id: commandId,
          tenant_id: "tenant_basilica",
          location_id: "loc_basilica_main",
          local_master_instance_id: "lm_other_binding",
          type: "STAFF_PICKUP_ACKNOWLEDGE",
          status: "delivered",
          payload: {
            request_id: "relay_wrong_binding_request",
            pickup_id: "pickup_wrong_binding"
          }
        }]
      });
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

  const capturedAck = ackBody as { status?: string; error?: string };
  assert.equal(capturedAck.status, "failed");
  assert.equal(capturedAck.error, "Relay command does not belong to this LocalMaster binding.");
});

test("unsupported relay command is ACKed as failed after local rejection", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const now = Date.now();
  const commandId = "relay_unsupported_command";
  let ackBody: unknown = null;

  writeCloudBindingForTest({
    localMasterInstanceId: "lm_test_unsupported_command",
    now,
    relayBaseUrl: "http://relay.test",
    relayToken: "relay_token_unsupported"
  });

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/local-masters/commands/pending")) {
      return jsonResponse({
        data: [{
          command_id: commandId,
          tenant_id: "tenant_basilica",
          location_id: "loc_basilica_main",
          local_master_instance_id: "lm_test_unsupported_command",
          type: "UNSUPPORTED_TEST_COMMAND",
          status: "delivered",
          payload: { request_id: "relay_unsupported_request" }
        }]
      });
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

  const capturedAck = ackBody as { status?: string; error?: string };
  assert.equal(capturedAck.status, "failed");
  assert.equal(capturedAck.error, "Unsupported relay command type: UNSUPPORTED_TEST_COMMAND");
});

test("ADMIN_BOOTSTRAP_REFRESH updates the local bootstrap user projection", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const now = Date.now();
  const commandId = "relay_admin_bootstrap_refresh";
  let ackBody: unknown = null;

  writeCloudBindingForTest({
    localMasterInstanceId: "lm_test_admin_refresh",
    now,
    relayBaseUrl: "http://relay.test",
    relayToken: "relay_token_admin_refresh"
  });

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/local-masters/commands/pending")) {
      return jsonResponse({
        data: [{
          command_id: commandId,
          tenant_id: "tenant_basilica",
          location_id: "loc_basilica_main",
          local_master_instance_id: "lm_test_admin_refresh",
          type: "ADMIN_BOOTSTRAP_REFRESH",
          status: "delivered",
          payload: { triggered_at: new Date(now).toISOString() }
        }]
      });
    }

    if (url.endsWith("/api/local-masters/bootstrap")) {
      return jsonResponse({
        tenant: {
          id: "tenant_basilica",
          name: "Basilica Test",
          slug: "basilica-test",
          email: null,
          phone: null,
          website: null,
          status: "ACTIVE",
          created_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString()
        },
        location: {
          id: "loc_basilica_main",
          tenant_id: "tenant_basilica",
          name: "Basilica Main",
          slug: "basilica-main",
          address: null,
          local_master_instance_id: "lm_test_admin_refresh",
          service_mode: "TABLE_SERVICE",
          status: "ACTIVE",
          created_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString()
        },
        service_mode: "TABLE_SERVICE",
        output_stations: [],
        users: [{
          user_id: "user_bootstrap_refresh",
          email: "refresh@example.test",
          display_name: "Refresh User",
          role: "MANAGER",
          status: "ACTIVE",
          pin_hash: "pbkdf2_sha256$120000$salt$hash",
          is_active: true
        }],
        bootstrapped_at: new Date(now).toISOString()
      });
    }

    if (url.endsWith("/api/local-masters/commands/" + commandId + "/ack")) {
      ackBody = JSON.parse(String(init?.body ?? "{}"));
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: true });
  };
  console.warn = () => undefined;

  try {
    await pollRelayCommands();
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }

  const bootstrapRow = getDrizzleDatabase()
    .select()
    .from(localState)
    .where(eq(localState.key, "localMaster.bootstrap"))
    .limit(1)
    .get();
  const bootstrap = JSON.parse(bootstrapRow?.valueJson ?? "{}") as { users?: Array<{ user_id: string; pin_hash: string | null }> };
  const capturedAck = ackBody as { status?: string; result?: { refreshed?: boolean } };

  assert.equal(capturedAck.status, "accepted");
  assert.equal(capturedAck.result?.refreshed, true);
  assert.equal(bootstrap.users?.[0]?.user_id, "user_bootstrap_refresh");
  assert.equal(bootstrap.users?.[0]?.pin_hash, "pbkdf2_sha256$120000$salt$hash");
});

test("unpaired PowerSync does not block local REST reads", async () => {
  const response = await app.inject({ method: "GET", url: "/api/orders/open" });

  assert.equal(response.statusCode, 200, response.body);
  assert.ok(Array.isArray(response.json<{ data: unknown[] }>().data));
});

test("paired Staff device can create a local PIN session", async () => {
  const salt = "local-auth-test-salt";
  const pinHash = "pbkdf2_sha256$120000$" + salt + "$" + pbkdf2Sync("246810", salt, 120_000, 32, "sha256").toString("hex");
  getDrizzleDatabase().insert(localState).values({
    key: "localMaster.bootstrap",
    valueJson: JSON.stringify({ users: [{ user_id: "local_owner", email: "owner@example.test", display_name: "Local Owner", role: "OWNER", status: "ACTIVE", pin_hash: pinHash, is_active: true }] }),
    updatedAt: Date.now(),
  }).onConflictDoUpdate({ target: localState.key, set: { valueJson: JSON.stringify({ users: [{ user_id: "local_owner", email: "owner@example.test", display_name: "Local Owner", role: "OWNER", status: "ACTIVE", pin_hash: pinHash, is_active: true }] }), updatedAt: Date.now() } }).run();

  const pairing = await postJson<{ code: string }>("/api/local-master/pairing-sessions", {}, 201);
  const device = await postJson<{ terminalId: string; terminalSecret: string }>("/api/local-auth/devices/pair", {
    code: pairing.code, device_name: "Staff Tablet", local_master_url: "http://localhost:3000",
  }, 201);
  const usersResponse = await app.inject({ method: "GET", url: "/api/local-auth/users", headers: { "x-easytable-device-id": device.terminalId, "x-easytable-device-secret": device.terminalSecret } });
  assert.equal(usersResponse.statusCode, 200, usersResponse.body);
  assert.equal(usersResponse.json<Array<{ user_id: string }>>()[0]?.user_id, "local_owner");

  const session = await postJson<{ token: string; role: string }>("/api/local-auth/pin", {
    device_id: device.terminalId, device_secret: device.terminalSecret, user_id: "local_owner", pin: "246810",
  }, 200);
  assert.equal(session.role, "OWNER");
  const sessionResponse = await app.inject({ method: "GET", url: "/api/local-auth/session", headers: { authorization: "Bearer " + session.token } });
  assert.equal(sessionResponse.statusCode, 200, sessionResponse.body);
});

async function postJson<T>(url: string, request: unknown, expectedStatus: number): Promise<T> {
  const normalizedRequest = normalizeCashTestRequest(url, request);
  const response = await app.inject({
    method: "POST",
    url,
    payload: { request: normalizedRequest }
  });

  assert.equal(response.statusCode, expectedStatus, response.body);
  return response.json<T>();
}
async function getJson<T>(url: string, expectedStatus = 200): Promise<T> {
  const response = await app.inject({ method: "GET", url });

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

async function createPrinter(name: string, provider: "browser") {
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

async function salesReport(businessDate: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/reporting/sales?business_date=" + encodeURIComponent(businessDate) + "&business_day_cutover_time=04%3A00"
  });

  assert.equal(response.statusCode, 200, response.body);
  return response.json<SalesReport>();
}

async function getOrderSnapshot(orderId: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/orders/" + encodeURIComponent(orderId) + "/snapshot"
  });

  assert.equal(response.statusCode, 200, response.body);
  return response.json<OrderSnapshotResponse>();
}

async function createStorno(orderId: string, request: object, expectedStatus: number) {
  const response = await app.inject({
    method: "POST",
    url: "/api/orders/" + encodeURIComponent(orderId) + "/stornos",
    payload: { request }
  });

  assert.equal(response.statusCode, expectedStatus, response.body);
  return response.json<StornoResult>();
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
  paymentMethod: "CASH",
  cash: { received_cash?: number; change_given?: number; lines?: BasketLine[]; terminal_id?: string } = {}
) {
  const lines = cash.lines ?? [basketLine(requestId + "_line", 1200)];
  const total = lines.reduce((sum, line) => sum + line.line_total, 0);
  return {
    request_id: requestId,
    lines,
    table_context: null,
    payment_method: paymentMethod,
    ...cash,
    received_cash: cash.received_cash ?? total,
    change_given: cash.change_given ?? Math.max(0, (cash.received_cash ?? total) - total)
  };
}

function normalizeCashTestRequest(url: string, request: unknown) {
  if (url !== "/api/payments/cash/complete" || !request || typeof request !== "object") return request;
  const value = request as Record<string, unknown>;
  if (value.received_cash !== undefined) return request;
  const lines = Array.isArray(value.lines) ? value.lines as BasketLine[] : [];
  const total = lines.reduce((sum, line) => sum + line.line_total, 0);
  return { ...value, received_cash: total, change_given: 0 };
}

function basketLine(id: string, amount: number, quantity = 1): BasketLine {
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
    quantity,
    line_total: amount * quantity
  };
}

function seedTestTableLayout() {
  const now = Date.now();
  const db = getDrizzleDatabase();

  db.transaction((tx) => {
    tx.insert(layoutFloors).values([
      { id: "floor_basilica_eg", locationId: "loc_basilica_main", name: "EG", sortOrder: 10, createdAt: now, updatedAt: now },
      { id: "floor_basilica_og", locationId: "loc_basilica_main", name: "OG", sortOrder: 20, createdAt: now, updatedAt: now }
    ]).run();
    tx.insert(layoutAreas).values([
      { id: "area_basilica_bar", floorId: "floor_basilica_eg", name: "Bar", sortOrder: 10, createdAt: now, updatedAt: now },
      { id: "area_basilica_fumoir", floorId: "floor_basilica_eg", name: "Fumoir", sortOrder: 20, createdAt: now, updatedAt: now },
      { id: "area_basilica_og_lounge", floorId: "floor_basilica_og", name: "Lounge", sortOrder: 10, createdAt: now, updatedAt: now }
    ]).run();
    tx.insert(layoutTables).values([
      { id: "table_basilica_bar_1", areaId: "area_basilica_bar", name: "1", seats: 2, sortOrder: 10, createdAt: now, updatedAt: now },
      { id: "table_basilica_fumoir_2", areaId: "area_basilica_fumoir", name: "2", seats: 4, sortOrder: 10, createdAt: now, updatedAt: now },
      { id: "table_basilica_fumoir_3", areaId: "area_basilica_fumoir", name: "3", seats: 4, sortOrder: 20, createdAt: now, updatedAt: now },
      { id: "table_basilica_og_30", areaId: "area_basilica_og_lounge", name: "30", seats: 4, sortOrder: 10, createdAt: now, updatedAt: now }
    ]).run();
  });
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
  const area = tableId.includes("_fumoir_")
    ? { id: "area_basilica_fumoir", name: "Fumoir", floorId: "floor_basilica_eg", floorName: "EG" }
    : tableId.includes("_og_")
      ? { id: "area_basilica_og_lounge", name: "Lounge", floorId: "floor_basilica_og", floorName: "OG" }
      : { id: "area_basilica_bar", name: "Bar", floorId: "floor_basilica_eg", floorName: "EG" };

  return {
    tenant_id: "tenant_basilica",
    location_id: "loc_basilica_main",
    floor_id: area.floorId,
    area_id: area.id,
    table_id: tableId,
    table_name: tableName,
    area_name: area.name,
    floor_name: area.floorName,
    seats: 2
  };
}
