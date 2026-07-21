import assert from "node:assert/strict";
import { test } from "node:test";

import {
  availableCategories,
  buildAnalyticsViewModel,
  datesInRange,
  defaultAnalyticsFilters,
  rangeForPreset
} from "./analyticsModel.js";
import type { SalesLedgerEntry, SalesReport } from "../../../lib/local-master.js";

const baseFilters = defaultAnalyticsFilters(new Date(2026, 6, 8));

test("range helpers produce deterministic analytics dates", () => {
  const now = new Date(2026, 6, 8, 12);

  assert.deepEqual(rangeForPreset("today", now), { from: "2026-07-08", to: "2026-07-08" });
  assert.deepEqual(rangeForPreset("yesterday", now), { from: "2026-07-07", to: "2026-07-07" });
  assert.deepEqual(rangeForPreset("week", now), { from: "2026-07-02", to: "2026-07-08" });
  assert.deepEqual(rangeForPreset("month", now), { from: "2026-07-01", to: "2026-07-08" });
  assert.deepEqual(datesInRange("2026-07-06", "2026-07-08"), ["2026-07-06", "2026-07-07", "2026-07-08"]);
  assert.throws(() => datesInRange("2026-07-08", "2026-07-06"), /Von-Datum/);
});

test("analytics model derives KPI, payment, product and storno data from ledger entries", () => {
  const model = buildAnalyticsViewModel([report("2026-07-08", [
    sale({ orderId: "order_1", lineId: "line_1", productId: "prod_1", productName: "Espresso", category: "Bar", quantity: 2, gross: 800, tax: 60 }),
    sale({ orderId: "order_1", lineId: "line_2", productId: "prod_2", productName: "Wasser", category: "Bar", quantity: 1, gross: 300, tax: 22 }),
    payment({ orderId: "order_1", method: "CASH", gross: 1100 }),
    storno({ orderId: "order_1", lineId: "line_1", productId: "prod_1", productName: "Espresso", category: "Bar", quantity: -1, gross: -400, tax: -30 }),
    refund({ orderId: "order_1", method: "CASH", gross: -400 })
  ])], baseFilters);

  assert.equal(model.grossTotal, 700);
  assert.equal(model.taxTotal, 52);
  assert.equal(model.netTotal, 648);
  assert.equal(model.orderCount, 1);
  assert.equal(model.itemCount, 2);
  assert.equal(model.stornoTotal, 400);
  assert.deepEqual(model.paymentTotals, { cash: 700, walleeTerminal: 0 });
  assert.equal(model.productRows.find((row) => row.productName === "Espresso")?.quantity, 1);
  assert.deepEqual(model.revenueSeries, [{ date: "2026-07-08", gross: 700, storno: 400 }]);
});

test("analytics filters payment, category, terminal and can exclude stornos", () => {
  const reports = [report("2026-07-08", [
    sale({ orderId: "order_1", productId: "prod_1", category: "Bar", gross: 800, terminalId: "terminal_a", method: "CASH" }),
    payment({ orderId: "order_1", method: "CASH", gross: 800, terminalId: "terminal_a" }),
    sale({ orderId: "order_2", productId: "prod_2", category: "Kitchen", gross: 1200, terminalId: "terminal_b", method: "WALLEE_TERMINAL" }),
    payment({ orderId: "order_2", method: "WALLEE_TERMINAL", gross: 1200, terminalId: "terminal_b" }),
    storno({ orderId: "order_2", productId: "prod_2", category: "Kitchen", gross: -300, terminalId: "terminal_b", method: "WALLEE_TERMINAL" }),
    refund({ orderId: "order_2", method: "WALLEE_TERMINAL", gross: -300, terminalId: "terminal_b" })
  ])];

  assert.deepEqual(availableCategories(reports), ["Bar", "Kitchen"]);
  assert.equal(buildAnalyticsViewModel(reports, { ...baseFilters, paymentMethod: "CASH" }).grossTotal, 800);
  assert.equal(buildAnalyticsViewModel(reports, { ...baseFilters, category: "Kitchen" }).grossTotal, 900);
  assert.equal(buildAnalyticsViewModel(reports, { ...baseFilters, terminalId: "terminal_b" }).paymentTotals.walleeTerminal, 900);
  assert.equal(buildAnalyticsViewModel(reports, { ...baseFilters, includeStornos: false }).grossTotal, 2000);
});

test("analytics keeps product rows separated by snapshot identity values", () => {
  const model = buildAnalyticsViewModel([report("2026-07-08", [
    sale({ orderId: "order_1", productId: "prod_same", productName: "Menu", category: "Lunch", gross: 1000 }),
    sale({ orderId: "order_2", productId: "prod_same", productName: "Menu", category: "Dinner", gross: 1400 })
  ])], baseFilters);

  assert.equal(model.productRows.length, 2);
  assert.deepEqual(model.productRows.map((row) => row.productCategory).sort(), ["Dinner", "Lunch"]);
});

test("analytics groups complimentary value by product and operator without increasing revenue", () => {
  const offered = entry({
    entryType: "COMPLIMENTARY_RECORDED",
    orderId: "order_offer",
    productId: "prod_offer",
    productName: "Bier",
    category: "Bar",
    quantity: 2,
    gross: 0,
    tax: 0
  });
  offered.complimentary_value = 1000;
  offered.actor_user_id = "user_1";
  offered.actor_display_name = "Anna";
  const model = buildAnalyticsViewModel([report("2026-07-08", [offered])], baseFilters);

  assert.equal(model.grossTotal, 0);
  assert.equal(model.complimentaryQuantity, 2);
  assert.equal(model.complimentaryValue, 1000);
  assert.deepEqual(model.complimentaryRows, [{
    key: "prod_offer:user_1",
    productName: "Bier",
    actorName: "Anna",
    quantity: 2,
    value: 1000
  }]);
});

function report(date: string, entries: SalesLedgerEntry[]): SalesReport {
  return {
    business_date: date,
    window_start_ms: 0,
    window_end_ms: 0,
    gross_total: 0,
    tax_total: 0,
    order_count: 0,
    item_count: 0,
    complimentary_quantity: 0,
    complimentary_value: 0,
    payment_totals: { cash: 0, wallee_terminal: 0 },
    product_sales: [],
    complimentary_sales: [],
    entries
  };
}

function sale(input: Partial<EntryInput> = {}) {
  return entry({
    ...input,
    entryType: "SALE_COMPLETED",
    quantity: input.quantity ?? 1,
    gross: input.gross ?? 1000,
    tax: input.tax ?? 75
  });
}

function storno(input: Partial<EntryInput> = {}) {
  return entry({
    ...input,
    entryType: "ORDER_PARTIALLY_VOIDED",
    quantity: input.quantity ?? -1,
    gross: input.gross ?? -1000,
    tax: input.tax ?? -75
  });
}

function payment(input: Partial<EntryInput> = {}) {
  return entry({
    ...input,
    entryType: "PAYMENT_RECORDED",
    productId: null,
    productName: null,
    category: null,
    quantity: 0,
    tax: 0
  });
}

function refund(input: Partial<EntryInput> = {}) {
  return entry({
    ...input,
    entryType: "REFUND_RECORDED",
    productId: null,
    productName: null,
    category: null,
    quantity: 0,
    tax: 0
  });
}

type EntryInput = {
  entryType: SalesLedgerEntry["entry_type"];
  orderId: string;
  lineId: string | null;
  productId: string | null;
  productName: string | null;
  category: string | null;
  quantity: number;
  gross: number;
  tax: number;
  method: string;
  terminalId: string | null;
};

function entry(input: Partial<EntryInput>): SalesLedgerEntry {
  const orderId = input.orderId ?? "order_1";
  return {
    id: "ledger_" + Math.random(),
    request_id: "request_" + orderId,
    entry_type: input.entryType ?? "SALE_COMPLETED",
    order_id: orderId,
    order_number: "R-" + orderId,
    payment_id: null,
    original_entry_id: null,
    line_id: input.lineId ?? "line_" + orderId,
    product_id: input.productId === undefined ? "prod_1" : input.productId,
    product_name: input.productName === undefined ? "Produkt" : input.productName,
    product_category: input.category === undefined ? "Bar" : input.category,
    tax_code_id: "tax_normal",
    tax_rate_bps: 810,
    quantity: input.quantity ?? 1,
    gross_amount: input.gross ?? 1000,
    tax_amount: input.tax ?? 75,
    complimentary_value: 0,
    actor_user_id: null,
    actor_display_name: null,
    actor_role: null,
    actor_device_id: null,
    payment_method: input.method ?? "CASH",
    terminal_id: input.terminalId ?? "terminal_a",
    provider: null,
    provider_transaction_id: null,
    provider_refund_id: null,
    provider_status: null,
    reason: null,
    business_date: "2026-07-08",
    occurred_at: 1
  };
}
