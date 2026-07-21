import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import {
  orderSnapshotLines as orderSnapshotLinesTable,
  orderSnapshots as orderSnapshotsTable,
  salesLedgerEntries as salesLedgerEntriesTable
} from "../db/schema.js";
import {
  appendOutboxEvent,
  beginIdempotentCommand,
  completeIdempotentCommand,
  failIdempotentCommand
} from "./commandStore.js";
import {
  orderSnapshots,
  payments,
  persistOrderSnapshots,
  persistSalesLedgerEntries,
  salesLedgerEntries
} from "./storeState.js";
import type {
  FinalOrderSnapshot,
  LocalPayment,
  SalesLedgerEntry,
  SalesLedgerEntryType
} from "./storeState.js";
import type {
  BasketLine,
  PaymentResult,
  CreateOrderStornoRequest,
  OrderSnapshotListItem,
  OrderSnapshotResponse,
  SalesReport,
  StornoResult
} from "../types.js";

type PosOrderForSnapshot = {
  id: string;
  order_number: string;
  table_context: FinalOrderSnapshot["table_context"];
  lines: BasketLine[];
  subtotal: number;
  tax_total: number;
  total: number;
  actor?: FinalOrderSnapshot["actor"];
};

type BusinessWindow = {
  businessDate: string;
  startMs: number;
  endMs: number;
};

export function recordCompletedSaleSnapshot(
  order: PosOrderForSnapshot,
  payment: LocalPayment,
  completedPayment: PaymentResult
): FinalOrderSnapshot {
  const existing = getSnapshotByOrderId(order.id);
  if (existing) {
    return existing;
  }

  const paidAt = completedPayment.completed_at ?? completedPayment.paid_at;
  const snapshot: FinalOrderSnapshot = {
    id: "snap_" + order.id,
    order_id: order.id,
    order_number: order.order_number,
    snapshot_type: "PAID",
    table_context: order.table_context,
    lines: cloneLines(order.lines),
    subtotal: order.subtotal,
    tax_total: order.tax_total,
    total: order.total,
    actor: order.actor ?? null,
    payment: {
      payment_id: completedPayment.payment_id,
      request_id: completedPayment.request_id,
      method: completedPayment.payment_method,
      amount: completedPayment.amount,
      terminal_id: completedPayment.terminal_id,
      provider: completedPayment.provider,
      provider_transaction_id: completedPayment.provider_transaction_id,
      provider_status: completedPayment.provider_status,
      lifecycle_state: completedPayment.lifecycle_state,
      paid_at: paidAt
    },
    terminal_id: completedPayment.terminal_id,
    business_date: businessDateForTimestamp(paidAt),
    created_at: paidAt
  };

  insertOrderSnapshot(snapshot);
  orderSnapshots.push(snapshot);
  appendSaleLedgerEntries(snapshot);
  appendPaymentLedgerEntry(snapshot, payment);
  persistOrderSnapshots();
  persistSalesLedgerEntries();
  appendOutboxEvent("ORDER_SNAPSHOT_RECORDED", snapshot.order_id, snapshot);
  appendOutboxEvent("SALES_LEDGER_UPDATED", snapshot.order_id, {
    order_id: snapshot.order_id,
    entry_types: ["SALE_COMPLETED", "PAYMENT_RECORDED"],
    ledger_entries: listSalesLedgerEntries().filter((entry) => entry.order_id === snapshot.order_id)
  });

  return snapshot;
}

export function recordComplimentarySaleSnapshot(
  order: PosOrderForSnapshot,
  requestId: string,
  terminalId: string | null
): FinalOrderSnapshot {
  const existing = getSnapshotByOrderId(order.id);
  if (existing) return existing;

  const completedAt = Date.now();
  const snapshot: FinalOrderSnapshot = {
    id: "snap_" + order.id,
    order_id: order.id,
    order_number: order.order_number,
    snapshot_type: "COMPLIMENTARY",
    table_context: order.table_context,
    lines: cloneLines(order.lines),
    subtotal: 0,
    tax_total: 0,
    total: 0,
    payment: {
      payment_id: "complimentary_" + order.id,
      request_id: requestId,
      method: "COMPLIMENTARY",
      amount: 0,
      terminal_id: terminalId,
      provider: "LOCAL",
      provider_transaction_id: null,
      provider_status: "NOT_REQUIRED",
      lifecycle_state: "completed",
      paid_at: completedAt
    },
    actor: order.actor ?? null,
    terminal_id: terminalId,
    business_date: businessDateForTimestamp(completedAt),
    created_at: completedAt
  };

  insertOrderSnapshot(snapshot);
  orderSnapshots.push(snapshot);
  appendSaleLedgerEntries(snapshot);
  persistOrderSnapshots();
  persistSalesLedgerEntries();
  appendOutboxEvent("ORDER_SNAPSHOT_RECORDED", snapshot.order_id, snapshot);
  appendOutboxEvent("SALES_LEDGER_UPDATED", snapshot.order_id, {
    order_id: snapshot.order_id,
    entry_types: ["COMPLIMENTARY_RECORDED"],
    ledger_entries: listSalesLedgerEntries().filter((entry) => entry.order_id === snapshot.order_id)
  });
  return snapshot;
}

export function getOrderSnapshot(orderId: string): OrderSnapshotResponse {
  const snapshot = requireOrderSnapshot(orderId);
  return snapshotResponse(snapshot);
}

export function listOrderSnapshotsForReporting(filters: {
  from?: string;
  to?: string;
  query?: string;
  payment_method?: string;
  terminal_id?: string;
  storno_state?: string;
} = {}): OrderSnapshotListItem[] {
  const query = filters.query?.trim().toLowerCase() ?? "";
  const paymentMethod = filters.payment_method?.trim();
  const terminalId = filters.terminal_id?.trim();
  const stornoState = filters.storno_state?.trim().toUpperCase();

  return listOrderSnapshots()
    .map((snapshot) => {
      const response = snapshotResponse(snapshot);
      return {
        ...response,
        storno_state: stornoStateForSnapshot(response)
      };
    })
    .filter((snapshot) => !filters.from || snapshot.business_date >= filters.from)
    .filter((snapshot) => !filters.to || snapshot.business_date <= filters.to)
    .filter((snapshot) => !paymentMethod || snapshot.payment.method === paymentMethod)
    .filter((snapshot) => !terminalId || snapshot.terminal_id === terminalId || snapshot.payment.terminal_id === terminalId)
    .filter((snapshot) => !stornoState || snapshot.storno_state === stornoState)
    .filter((snapshot) => {
      if (!query) return true;
      const searchable = [
        snapshot.order_id,
        snapshot.order_number,
        snapshot.table_context?.table_name,
        snapshot.payment.provider_transaction_id,
        snapshot.payment.provider,
        ...snapshot.lines.map((line) => line.product_name)
      ].filter(Boolean).join(" ").toLowerCase();
      return searchable.includes(query);
    })
    .sort((left, right) => right.created_at - left.created_at || right.order_number.localeCompare(left.order_number));
}

export function createOrderStorno(orderId: string, request: CreateOrderStornoRequest): StornoResult {
  const command = beginIdempotentCommand("ORDER_STORNO", request.request_id, {
    order_id: orderId,
    kind: request.kind,
    reason: request.reason,
    terminal_id: request.terminal_id ?? null,
    lines: request.lines ?? null,
    business_date: request.business_date ?? null,
    provider: request.provider ?? null,
    provider_refund_id: request.provider_refund_id ?? null,
    provider_status: request.provider_status ?? null
  });

  if (command.mode === "replay") {
    return command.result as StornoResult;
  }

  try {
    const result = createOrderStornoUnchecked(orderId, request);
    appendOutboxEvent("ORDER_STORNO_RECORDED", orderId, result);
    appendOutboxEvent("SALES_LEDGER_UPDATED", orderId, {
      order_id: orderId,
      entry_types: result.ledger_entries.map((entry) => entry.entry_type),
      ledger_entries: result.ledger_entries
    });
    return completeIdempotentCommand(command.entry, result);
  } catch (error) {
    return failIdempotentCommand(command.entry, error);
  }
}

export function getSalesReportForBusinessDate(
  businessDate: string,
  businessDayCutoverTime = "00:00"
): SalesReport {
  const window = businessDayWindow(businessDate, businessDayCutoverTime);
  return buildSalesReport(window);
}

export function getSalesReportForWindow(
  businessDate: string,
  startMs: number,
  endMs: number
): SalesReport {
  return buildSalesReport({ businessDate, startMs, endMs });
}

function createOrderStornoUnchecked(orderId: string, request: CreateOrderStornoRequest): StornoResult {
  const snapshot = requireOrderSnapshot(orderId);
  const reason = requiredText(request.reason, "Storno reason is required.");
  const terminalId = request.terminal_id?.trim() || null;
  const occurredAt = Date.now();
  const businessDate = request.business_date?.trim() || businessDateForTimestamp(occurredAt);
  const providerStatus = request.provider_status?.trim() || defaultStornoProviderStatus(snapshot);
  const provider = request.provider?.trim() || snapshot.payment.provider;

  if (providerStatus === "FAILED" || providerStatus === "DECLINED" || providerStatus === "CANCELLED" || providerStatus === "TIMEOUT") {
    throw new Error("Provider refund was not accepted; no local storno ledger was recorded.");
  }

  const lineQuantities = request.kind === "FULL"
    ? remainingQuantitiesForSnapshot(snapshot)
    : requestedPartialQuantities(snapshot, request.lines ?? []);
  const correctionEntries: SalesLedgerEntry[] = [];

  for (const [lineId, quantity] of lineQuantities) {
    const line = snapshot.lines.find((candidate) => candidate.id === lineId);
    if (!line) {
      throw new Error("Unknown order snapshot line: " + lineId);
    }

    const remaining = remainingQuantityForLine(snapshot.order_id, lineId, line.quantity);
    if (quantity <= 0) {
      throw new Error("Storno quantity must be positive.");
    }
    if (quantity > remaining) {
      throw new Error("Storno quantity exceeds remaining refundable quantity for " + line.product_name + ".");
    }

    correctionEntries.push(toStornoSaleEntry({
      snapshot,
      line,
      quantity,
      request,
      reason,
      terminalId,
      provider,
      providerStatus,
      occurredAt,
      businessDate
    }));
  }

  if (correctionEntries.length === 0) {
    throw new Error("Order has no refundable quantity remaining.");
  }

  const refundTotal = correctionEntries.reduce((sum, entry) => sum + entry.gross_amount, 0);
  const refundEntry = toRefundLedgerEntry({
    snapshot,
    request,
    reason,
    terminalId,
    provider,
    providerStatus,
    providerRefundId: request.provider_refund_id?.trim() || null,
    amount: refundTotal,
    occurredAt,
    businessDate
  });

  insertSalesLedgerEntries([...correctionEntries, refundEntry]);
  salesLedgerEntries.push(...correctionEntries, refundEntry);
  persistSalesLedgerEntries();

  return {
    order_id: snapshot.order_id,
    order_number: snapshot.order_number,
    kind: request.kind,
    reason,
    refunded_amount: Math.abs(refundTotal),
    remaining_amount: Math.max(0, snapshot.total + refundLedgerForOrder(snapshot.order_id).reduce((sum, entry) => sum + entry.gross_amount, 0)),
    provider,
    provider_transaction_id: snapshot.payment.provider_transaction_id,
    provider_refund_id: refundEntry.provider_refund_id,
    provider_status: providerStatus,
    ledger_entries: [...correctionEntries, refundEntry]
  };
}

function appendSaleLedgerEntries(snapshot: FinalOrderSnapshot) {
  const entries: SalesLedgerEntry[] = [];
  for (const line of snapshot.lines) {
    const chargedQuantity = line.quantity - line.complimentary_quantity;
    if (chargedQuantity > 0) entries.push({
      id: "ledger_sale_" + snapshot.order_id + "_" + line.id,
      request_id: snapshot.payment.request_id,
      entry_type: "SALE_COMPLETED",
      order_id: snapshot.order_id,
      order_number: snapshot.order_number,
      payment_id: snapshot.payment.payment_id,
      original_entry_id: null,
      line_id: line.id,
      product_id: line.product_id,
      product_name: line.product_name,
      product_category: line.product_category,
      tax_code_id: line.tax_code_id,
      tax_rate_bps: line.tax_rate_bps,
      quantity: chargedQuantity,
      gross_amount: line.line_total,
      tax_amount: calculateIncludedTax(line.line_total, line.tax_rate_bps),
      complimentary_value: 0,
      ...actorLedgerFields(snapshot),
      payment_method: snapshot.payment.method,
      terminal_id: snapshot.terminal_id,
      provider: snapshot.payment.provider,
      provider_transaction_id: snapshot.payment.provider_transaction_id,
      provider_refund_id: null,
      provider_status: snapshot.payment.provider_status,
      reason: null,
      business_date: snapshot.business_date,
      occurred_at: snapshot.created_at
    });
    if (line.complimentary_quantity > 0) entries.push({
      id: "ledger_complimentary_" + snapshot.order_id + "_" + line.id,
      request_id: snapshot.payment.request_id,
      entry_type: "COMPLIMENTARY_RECORDED",
      order_id: snapshot.order_id,
      order_number: snapshot.order_number,
      payment_id: snapshot.snapshot_type === "PAID" ? snapshot.payment.payment_id : null,
      original_entry_id: null,
      line_id: line.id,
      product_id: line.product_id,
      product_name: line.product_name,
      product_category: line.product_category,
      tax_code_id: line.tax_code_id,
      tax_rate_bps: line.tax_rate_bps,
      quantity: line.complimentary_quantity,
      gross_amount: 0,
      tax_amount: 0,
      complimentary_value: line.complimentary_value,
      ...actorLedgerFields(snapshot),
      payment_method: snapshot.snapshot_type === "PAID" ? snapshot.payment.method : null,
      terminal_id: snapshot.terminal_id,
      provider: null,
      provider_transaction_id: null,
      provider_refund_id: null,
      provider_status: null,
      reason: null,
      business_date: snapshot.business_date,
      occurred_at: snapshot.created_at
    });
  }
  insertSalesLedgerEntries(entries);
  salesLedgerEntries.push(...entries);
}

function appendPaymentLedgerEntry(snapshot: FinalOrderSnapshot, payment: LocalPayment) {
  const entry: SalesLedgerEntry = {
    id: "ledger_payment_" + payment.id,
    request_id: snapshot.payment.request_id,
    entry_type: "PAYMENT_RECORDED",
    order_id: snapshot.order_id,
    order_number: snapshot.order_number,
    payment_id: payment.id,
    original_entry_id: null,
    line_id: null,
    product_id: null,
    product_name: null,
    product_category: null,
    tax_code_id: null,
    tax_rate_bps: 0,
    quantity: 0,
    gross_amount: snapshot.payment.amount,
    tax_amount: 0,
    complimentary_value: 0,
    ...actorLedgerFields(snapshot),
    payment_method: snapshot.payment.method,
    terminal_id: snapshot.terminal_id,
    provider: snapshot.payment.provider,
    provider_transaction_id: snapshot.payment.provider_transaction_id,
    provider_refund_id: null,
    provider_status: snapshot.payment.provider_status,
    reason: null,
    business_date: snapshot.business_date,
    occurred_at: snapshot.created_at
  };
  insertSalesLedgerEntries([entry]);
  salesLedgerEntries.push(entry);
}

function toStornoSaleEntry(input: {
  snapshot: FinalOrderSnapshot;
  line: BasketLine;
  quantity: number;
  request: CreateOrderStornoRequest;
  reason: string;
  terminalId: string | null;
  provider: string;
  providerStatus: string;
  occurredAt: number;
  businessDate: string;
}): SalesLedgerEntry {
  const original = listSalesLedgerEntries().find(
    (entry) => entry.order_id === input.snapshot.order_id && entry.line_id === input.line.id && entry.entry_type === "SALE_COMPLETED"
  );
  const lineGross = input.line.unit_total * input.quantity;

  return {
    id: "ledger_storno_" + input.request.request_id + "_" + input.line.id,
    request_id: input.request.request_id,
    entry_type: input.request.kind === "FULL" ? "ORDER_VOIDED" : "ORDER_PARTIALLY_VOIDED",
    order_id: input.snapshot.order_id,
    order_number: input.snapshot.order_number,
    payment_id: input.snapshot.payment.payment_id,
    original_entry_id: original?.id ?? null,
    line_id: input.line.id,
    product_id: input.line.product_id,
    product_name: input.line.product_name,
    product_category: input.line.product_category,
    tax_code_id: input.line.tax_code_id,
    tax_rate_bps: input.line.tax_rate_bps,
    quantity: -input.quantity,
    gross_amount: -lineGross,
    tax_amount: -calculateIncludedTax(lineGross, input.line.tax_rate_bps),
    complimentary_value: 0,
    ...actorLedgerFields(input.snapshot),
    payment_method: input.snapshot.payment.method,
    terminal_id: input.terminalId,
    provider: input.provider,
    provider_transaction_id: input.snapshot.payment.provider_transaction_id,
    provider_refund_id: input.request.provider_refund_id?.trim() || null,
    provider_status: input.providerStatus,
    reason: input.reason,
    business_date: input.businessDate,
    occurred_at: input.occurredAt
  };
}

function toRefundLedgerEntry(input: {
  snapshot: FinalOrderSnapshot;
  request: CreateOrderStornoRequest;
  reason: string;
  terminalId: string | null;
  provider: string;
  providerStatus: string;
  providerRefundId: string | null;
  amount: number;
  occurredAt: number;
  businessDate: string;
}): SalesLedgerEntry {
  return {
    id: "ledger_refund_" + input.request.request_id,
    request_id: input.request.request_id,
    entry_type: "REFUND_RECORDED",
    order_id: input.snapshot.order_id,
    order_number: input.snapshot.order_number,
    payment_id: input.snapshot.payment.payment_id,
    original_entry_id: null,
    line_id: null,
    product_id: null,
    product_name: null,
    product_category: null,
    tax_code_id: null,
    tax_rate_bps: 0,
    quantity: 0,
    gross_amount: input.amount,
    tax_amount: 0,
    complimentary_value: 0,
    ...actorLedgerFields(input.snapshot),
    payment_method: input.snapshot.payment.method,
    terminal_id: input.terminalId,
    provider: input.provider,
    provider_transaction_id: input.snapshot.payment.provider_transaction_id,
    provider_refund_id: input.providerRefundId,
    provider_status: input.providerStatus,
    reason: input.reason,
    business_date: input.businessDate,
    occurred_at: input.occurredAt
  };
}

function buildSalesReport(window: BusinessWindow): SalesReport {
  const entries = listSalesLedgerEntries().filter(
    (entry) =>
      entry.occurred_at >= window.startMs &&
      entry.occurred_at < window.endMs &&
      isReportingEntry(entry.entry_type)
  );
  const saleEntries = entries.filter((entry) => isSaleCorrectionEntry(entry.entry_type));
  const complimentaryEntries = entries.filter((entry) => entry.entry_type === "COMPLIMENTARY_RECORDED");
  const paymentEntries = entries.filter((entry) => entry.entry_type === "PAYMENT_RECORDED" || entry.entry_type === "REFUND_RECORDED");
  const productSales = buildProductSales(saleEntries);
  const complimentarySales = buildComplimentarySales(complimentaryEntries);

  return {
    business_date: window.businessDate,
    window_start_ms: window.startMs,
    window_end_ms: window.endMs,
    gross_total: sum(saleEntries, "gross_amount"),
    tax_total: sum(saleEntries, "tax_amount"),
    order_count: new Set([...saleEntries, ...complimentaryEntries].map((entry) => entry.order_id)).size,
    item_count: sum(saleEntries, "quantity"),
    complimentary_quantity: sum(complimentaryEntries, "quantity"),
    complimentary_value: sum(complimentaryEntries, "complimentary_value"),
    payment_totals: {
      cash: sum(paymentEntries.filter((entry) => entry.payment_method === "CASH"), "gross_amount"),
      wallee_terminal: sum(paymentEntries.filter((entry) => entry.payment_method === "WALLEE_TERMINAL"), "gross_amount")
    },
    product_sales: productSales,
    complimentary_sales: complimentarySales,
    entries
  };
}

function buildProductSales(entries: SalesLedgerEntry[]) {
  const byProduct = new Map<string, {
    product_id: string;
    product_name: string;
    product_category: string;
    quantity: number;
    total: number;
  }>();

  for (const entry of entries) {
    if (!entry.product_id || !entry.product_name || !entry.product_category) continue;
    const key = entry.product_id + ":" + entry.product_name;
    const existing = byProduct.get(key);
    if (existing) {
      existing.quantity += entry.quantity;
      existing.total += entry.gross_amount;
    } else {
      byProduct.set(key, {
        product_id: entry.product_id,
        product_name: entry.product_name,
        product_category: entry.product_category,
        quantity: entry.quantity,
        total: entry.gross_amount
      });
    }
  }

  return Array.from(byProduct.values()).sort(
    (left, right) => right.total - left.total || left.product_name.localeCompare(right.product_name)
  );
}

function buildComplimentarySales(entries: SalesLedgerEntry[]) {
  return buildProductSales(entries.map((entry) => ({ ...entry, gross_amount: entry.complimentary_value })));
}

function requestedPartialQuantities(snapshot: FinalOrderSnapshot, lines: Array<{ line_id: string; quantity: number }>) {
  if (lines.length === 0) {
    throw new Error("Partial storno requires at least one line.");
  }

  const quantities = new Map<string, number>();
  for (const item of lines) {
    const lineId = requiredText(item.line_id, "Storno line id is required.");
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Storno quantity must be positive.");
    }
    if (!snapshot.lines.some((line) => line.id === lineId)) {
      throw new Error("Unknown order snapshot line: " + lineId);
    }
    quantities.set(lineId, (quantities.get(lineId) ?? 0) + item.quantity);
  }
  return quantities;
}

function remainingQuantitiesForSnapshot(snapshot: FinalOrderSnapshot) {
  const quantities = new Map<string, number>();
  for (const line of snapshot.lines) {
    const remaining = remainingQuantityForLine(snapshot.order_id, line.id, line.quantity);
    if (remaining > 0) {
      quantities.set(line.id, remaining);
    }
  }
  return quantities;
}

function remainingQuantityForLine(orderId: string, lineId: string, originalQuantity: number) {
  const refunded = listSalesLedgerEntries()
    .filter(
      (entry) =>
        entry.order_id === orderId &&
        entry.line_id === lineId &&
        (entry.entry_type === "ORDER_VOIDED" || entry.entry_type === "ORDER_PARTIALLY_VOIDED")
    )
    .reduce((sum, entry) => sum + Math.abs(entry.quantity), 0);
  return originalQuantity - refunded;
}

function refundLedgerForOrder(orderId: string) {
  return listSalesLedgerEntries().filter(
    (entry) =>
      entry.order_id === orderId &&
      (entry.entry_type === "ORDER_VOIDED" || entry.entry_type === "ORDER_PARTIALLY_VOIDED")
  );
}

function refundedTotalForOrder(orderId: string) {
  return Math.abs(refundLedgerForOrder(orderId).reduce((sum, entry) => sum + entry.gross_amount, 0));
}

function snapshotResponse(snapshot: FinalOrderSnapshot): OrderSnapshotResponse {
  return {
    ...snapshot,
    refunded_total: refundedTotalForOrder(snapshot.order_id),
    remaining_total: snapshot.total + refundLedgerForOrder(snapshot.order_id).reduce((sum, entry) => sum + entry.gross_amount, 0)
  };
}

function stornoStateForSnapshot(snapshot: OrderSnapshotResponse): OrderSnapshotListItem["storno_state"] {
  if (snapshot.refunded_total <= 0) return "NONE";
  return snapshot.remaining_total <= 0 ? "FULL" : "PARTIAL";
}

function requireOrderSnapshot(orderId: string) {
  const snapshot = getSnapshotByOrderId(orderId);
  if (!snapshot) {
    throw new Error("Order snapshot not found.");
  }
  return snapshot;
}

function defaultStornoProviderStatus(snapshot: FinalOrderSnapshot) {
  if (snapshot.payment.provider.startsWith("WALLEE")) {
    return "REFUND_RECORDED";
  }
  return "LOCAL_REFUND_RECORDED";
}

function isReportingEntry(entryType: SalesLedgerEntryType) {
  return entryType === "SALE_COMPLETED" ||
    entryType === "COMPLIMENTARY_RECORDED" ||
    entryType === "PAYMENT_RECORDED" ||
    entryType === "ORDER_VOIDED" ||
    entryType === "ORDER_PARTIALLY_VOIDED" ||
    entryType === "REFUND_RECORDED";
}

function isSaleCorrectionEntry(entryType: SalesLedgerEntryType) {
  return entryType === "SALE_COMPLETED" || entryType === "ORDER_VOIDED" || entryType === "ORDER_PARTIALLY_VOIDED";
}

function businessDayWindow(businessDate: string, cutoverTime: string): BusinessWindow {
  const cutoverMinutes = parseCutoverMinutes(cutoverTime);
  const startDate = parseBusinessDate(businessDate);
  startDate.setHours(Math.floor(cutoverMinutes / 60), cutoverMinutes % 60, 0, 0);

  const endDate = new Date(startDate.getTime());
  endDate.setDate(endDate.getDate() + 1);

  return {
    businessDate,
    startMs: startDate.getTime(),
    endMs: endDate.getTime()
  };
}

function businessDateForTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return formatLocalDate(date);
}

function parseBusinessDate(businessDate: string) {
  const parts = businessDate.split("-").map((part) => Number(part));
  if (parts.length !== 3 || !Number.isInteger(parts[0]) || !Number.isInteger(parts[1]) || !Number.isInteger(parts[2])) {
    throw new Error("Business date must use YYYY-MM-DD.");
  }
  const [year, month, day] = parts as [number, number, number];
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    throw new Error("Business date must use YYYY-MM-DD.");
  }
  return parsed;
}

function parseCutoverMinutes(cutoverTime: string) {
  const [hoursText, minutesText] = cutoverTime.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("Business day cutover time must use HH:mm.");
  }
  return hours * 60 + minutes;
}

function formatLocalDate(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function calculateIncludedTax(grossAmount: number, taxRateBps: number) {
  if (taxRateBps <= 0) return 0;
  return Math.round((grossAmount * taxRateBps) / (10_000 + taxRateBps));
}

function sum<T extends Record<K, number>, K extends keyof T>(items: T[], key: K) {
  return items.reduce((total, item) => total + item[key], 0);
}

function requiredText(value: string | undefined, message: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(message);
  return normalized;
}

function cloneLines(lines: BasketLine[]): BasketLine[] {
  return lines.map((line) => ({
    ...line,
    variants: line.variants.map((variant) => ({ ...variant }))
  }));
}

function actorLedgerFields(snapshot: FinalOrderSnapshot) {
  return {
    actor_user_id: snapshot.actor?.user_id ?? null,
    actor_display_name: snapshot.actor?.display_name ?? null,
    actor_role: snapshot.actor?.role ?? null,
    actor_device_id: snapshot.actor?.device_id ?? null
  };
}

function getSnapshotByOrderId(orderId: string): FinalOrderSnapshot | null {
  const row = getDrizzleDatabase()
    .select()
    .from(orderSnapshotsTable)
    .where(eq(orderSnapshotsTable.orderId, orderId))
    .get();

  return row ? snapshotFromRow(row, linesForSnapshot(row.id)) : null;
}

function listOrderSnapshots(): FinalOrderSnapshot[] {
  return getDrizzleDatabase()
    .select()
    .from(orderSnapshotsTable)
    .orderBy(asc(orderSnapshotsTable.createdAt))
    .all()
    .map((row) => snapshotFromRow(row, linesForSnapshot(row.id)));
}

function linesForSnapshot(snapshotId: string): BasketLine[] {
  return getDrizzleDatabase()
    .select()
    .from(orderSnapshotLinesTable)
    .where(eq(orderSnapshotLinesTable.snapshotId, snapshotId))
    .orderBy(asc(orderSnapshotLinesTable.createdAt), asc(orderSnapshotLinesTable.id))
    .all()
    .map((row) => ({
      id: row.lineId,
      product_id: row.productId,
      product_type: row.productType as BasketLine["product_type"],
      product_name: row.productName,
      product_category: row.productCategory,
      base_price: row.basePrice,
      tax_code_id: row.taxCodeId,
      tax_code_name: row.taxCodeName,
      tax_rate_bps: row.taxRateBps,
      station: row.station,
      variants: parseJsonArray<BasketLine["variants"][number]>(row.variantsJson),
      unit_total: row.unitTotal,
      quantity: row.quantity,
      complimentary_quantity: row.complimentaryQuantity,
      complimentary_value: row.complimentaryValue,
      line_total: row.lineTotal
    }));
}

function snapshotFromRow(row: typeof orderSnapshotsTable.$inferSelect, lines: BasketLine[]): FinalOrderSnapshot {
  return {
    id: row.id,
    order_id: row.orderId,
    order_number: row.orderNumber,
    snapshot_type: row.snapshotType as FinalOrderSnapshot["snapshot_type"],
    table_context: row.tableContextJson ? parseJson(row.tableContextJson) as FinalOrderSnapshot["table_context"] : null,
    lines,
    subtotal: row.subtotal,
    tax_total: row.taxTotal,
    total: row.total,
    actor: row.actorJson ? parseJson(row.actorJson) as FinalOrderSnapshot["actor"] : null,
    payment: {
      payment_id: row.paymentId,
      request_id: row.paymentRequestId,
      method: row.paymentMethod,
      amount: row.paymentAmount,
      terminal_id: row.paymentTerminalId,
      provider: row.provider,
      provider_transaction_id: row.providerTransactionId,
      provider_status: row.providerStatus,
      lifecycle_state: row.paymentLifecycleState,
      paid_at: row.paidAt
    },
    terminal_id: row.terminalId,
    business_date: row.businessDate,
    created_at: row.createdAt
  };
}

function insertOrderSnapshot(snapshot: FinalOrderSnapshot) {
  getDrizzleDatabase().transaction((tx) => {
    tx.insert(orderSnapshotsTable)
      .values({
        id: snapshot.id,
        orderId: snapshot.order_id,
        orderNumber: snapshot.order_number,
        snapshotType: snapshot.snapshot_type,
        tableContextJson: snapshot.table_context ? JSON.stringify(snapshot.table_context) : null,
        actorJson: snapshot.actor ? JSON.stringify(snapshot.actor) : null,
        subtotal: snapshot.subtotal,
        taxTotal: snapshot.tax_total,
        total: snapshot.total,
        paymentId: snapshot.payment.payment_id,
        paymentRequestId: snapshot.payment.request_id,
        paymentMethod: snapshot.payment.method,
        paymentAmount: snapshot.payment.amount,
        paymentTerminalId: snapshot.payment.terminal_id,
        provider: snapshot.payment.provider,
        providerTransactionId: snapshot.payment.provider_transaction_id,
        providerStatus: snapshot.payment.provider_status,
        paymentLifecycleState: snapshot.payment.lifecycle_state,
        paidAt: snapshot.payment.paid_at,
        terminalId: snapshot.terminal_id,
        businessDate: snapshot.business_date,
        createdAt: snapshot.created_at
      })
      .onConflictDoNothing()
      .run();

    for (const line of snapshot.lines) {
      tx.insert(orderSnapshotLinesTable)
        .values({
          id: snapshot.id + ":" + line.id,
          snapshotId: snapshot.id,
          orderId: snapshot.order_id,
          lineId: line.id,
          productId: line.product_id,
          productType: line.product_type,
          productName: line.product_name,
          productCategory: line.product_category,
          basePrice: line.base_price,
          taxCodeId: line.tax_code_id,
          taxCodeName: line.tax_code_name,
          taxRateBps: line.tax_rate_bps,
          station: line.station,
          variantsJson: JSON.stringify(line.variants),
          unitTotal: line.unit_total,
          quantity: line.quantity,
          complimentaryQuantity: line.complimentary_quantity,
          complimentaryValue: line.complimentary_value,
          lineTotal: line.line_total,
          createdAt: snapshot.created_at
        })
        .onConflictDoNothing()
        .run();
    }
  });
}

function listSalesLedgerEntries(): SalesLedgerEntry[] {
  return getDrizzleDatabase()
    .select()
    .from(salesLedgerEntriesTable)
    .orderBy(asc(salesLedgerEntriesTable.occurredAt), asc(salesLedgerEntriesTable.id))
    .all()
    .map((row) => ({
      id: row.id,
      request_id: row.requestId,
      entry_type: row.entryType as SalesLedgerEntryType,
      order_id: row.orderId,
      order_number: row.orderNumber,
      payment_id: row.paymentId,
      original_entry_id: row.originalEntryId,
      line_id: row.lineId,
      product_id: row.productId,
      product_name: row.productName,
      product_category: row.productCategory,
      tax_code_id: row.taxCodeId,
      tax_rate_bps: row.taxRateBps,
      quantity: row.quantity,
      gross_amount: row.grossAmount,
      tax_amount: row.taxAmount,
      complimentary_value: row.complimentaryValue,
      actor_user_id: row.actorUserId,
      actor_display_name: row.actorDisplayName,
      actor_role: row.actorRole,
      actor_device_id: row.actorDeviceId,
      payment_method: row.paymentMethod,
      terminal_id: row.terminalId,
      provider: row.provider,
      provider_transaction_id: row.providerTransactionId,
      provider_refund_id: row.providerRefundId,
      provider_status: row.providerStatus,
      reason: row.reason,
      business_date: row.businessDate,
      occurred_at: row.occurredAt
    }));
}

function insertSalesLedgerEntries(entries: SalesLedgerEntry[]) {
  for (const entry of entries) {
    getDrizzleDatabase()
      .insert(salesLedgerEntriesTable)
      .values({
        id: entry.id,
        requestId: entry.request_id,
        entryType: entry.entry_type,
        orderId: entry.order_id,
        orderNumber: entry.order_number,
        paymentId: entry.payment_id,
        originalEntryId: entry.original_entry_id,
        lineId: entry.line_id,
        productId: entry.product_id,
        productName: entry.product_name,
        productCategory: entry.product_category,
        taxCodeId: entry.tax_code_id,
        taxRateBps: entry.tax_rate_bps,
        quantity: entry.quantity,
        grossAmount: entry.gross_amount,
        taxAmount: entry.tax_amount,
        complimentaryValue: entry.complimentary_value,
        actorUserId: entry.actor_user_id,
        actorDisplayName: entry.actor_display_name,
        actorRole: entry.actor_role,
        actorDeviceId: entry.actor_device_id,
        paymentMethod: entry.payment_method,
        terminalId: entry.terminal_id,
        provider: entry.provider,
        providerTransactionId: entry.provider_transaction_id,
        providerRefundId: entry.provider_refund_id,
        providerStatus: entry.provider_status,
        reason: entry.reason,
        businessDate: entry.business_date,
        occurredAt: entry.occurred_at
      })
      .onConflictDoNothing()
      .run();
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseJsonArray<T>(value: string): T[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed as T[] : [];
}

export function __resetReportingForTest() {
  getDrizzleDatabase().delete(salesLedgerEntriesTable).run();
  getDrizzleDatabase().delete(orderSnapshotLinesTable).run();
  getDrizzleDatabase().delete(orderSnapshotsTable).run();
  orderSnapshots.splice(0, orderSnapshots.length);
  salesLedgerEntries.splice(0, salesLedgerEntries.length);
  persistOrderSnapshots();
  persistSalesLedgerEntries();
}

export function __seedLedgerEntryForTest(entry: Partial<SalesLedgerEntry>) {
  const now = Date.now();
  const seeded: SalesLedgerEntry = {
    id: entry.id ?? "ledger_test_" + randomUUID(),
    request_id: entry.request_id ?? "test_request",
    entry_type: entry.entry_type ?? "SALE_COMPLETED",
    order_id: entry.order_id ?? "test_order",
    order_number: entry.order_number ?? "TEST-1",
    payment_id: entry.payment_id ?? null,
    original_entry_id: entry.original_entry_id ?? null,
    line_id: entry.line_id ?? null,
    product_id: entry.product_id ?? null,
    product_name: entry.product_name ?? null,
    product_category: entry.product_category ?? null,
    tax_code_id: entry.tax_code_id ?? null,
    tax_rate_bps: entry.tax_rate_bps ?? 0,
    quantity: entry.quantity ?? 0,
    gross_amount: entry.gross_amount ?? 0,
    tax_amount: entry.tax_amount ?? 0,
    complimentary_value: entry.complimentary_value ?? 0,
    actor_user_id: entry.actor_user_id ?? null,
    actor_display_name: entry.actor_display_name ?? null,
    actor_role: entry.actor_role ?? null,
    actor_device_id: entry.actor_device_id ?? null,
    payment_method: entry.payment_method ?? null,
    terminal_id: entry.terminal_id ?? null,
    provider: entry.provider ?? null,
    provider_transaction_id: entry.provider_transaction_id ?? null,
    provider_refund_id: entry.provider_refund_id ?? null,
    provider_status: entry.provider_status ?? null,
    reason: entry.reason ?? null,
    business_date: entry.business_date ?? businessDateForTimestamp(now),
    occurred_at: entry.occurred_at ?? now
  };
  insertSalesLedgerEntries([seeded]);
  salesLedgerEntries.push(seeded);
  persistSalesLedgerEntries();
  return seeded;
}
