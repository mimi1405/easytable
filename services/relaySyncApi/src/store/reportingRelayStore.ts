import { and, asc, eq } from "drizzle-orm";
import type { IncomingHttpHeaders } from "node:http";

import { getDrizzleDatabase } from "../db/client.js";
import { salesLedgerEntries } from "../db/schema.js";
import { requireStaffSession } from "./staffRelayStore.js";

type LedgerRow = typeof salesLedgerEntries.$inferSelect;

export async function getRelaySalesReport(
  headers: IncomingHttpHeaders,
  locationId: string,
  businessDate: string
) {
  const session = await requireStaffSession(headers, locationId);
  const normalizedBusinessDate = /^\d{4}-\d{2}-\d{2}$/.test(businessDate) ? businessDate : "";
  if (!normalizedBusinessDate) throw new Error("business_date must use YYYY-MM-DD.");

  const rows = await getDrizzleDatabase()
    .select()
    .from(salesLedgerEntries)
    .where(and(
      eq(salesLedgerEntries.tenantId, session.tenant_id),
      eq(salesLedgerEntries.locationId, locationId),
      eq(salesLedgerEntries.businessDate, normalizedBusinessDate)
    ))
    .orderBy(asc(salesLedgerEntries.occurredAt), asc(salesLedgerEntries.id));
  const entries = rows.filter((row) => isReportingEntry(row.entryType)).map(toLedgerEntry);
  const saleEntries = entries.filter((entry) => isSaleCorrectionEntry(entry.entry_type));
  const complimentaryEntries = entries.filter((entry) => entry.entry_type === "COMPLIMENTARY_RECORDED");
  const paymentEntries = entries.filter(
    (entry) => entry.entry_type === "PAYMENT_RECORDED" || entry.entry_type === "REFUND_RECORDED"
  );

  return {
    business_date: normalizedBusinessDate,
    window_start_ms: Date.parse(normalizedBusinessDate + "T00:00:00.000Z"),
    window_end_ms: Date.parse(normalizedBusinessDate + "T00:00:00.000Z") + 86_400_000,
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
    product_sales: buildProductSales(saleEntries, "gross_amount"),
    complimentary_sales: buildProductSales(complimentaryEntries, "complimentary_value"),
    entries
  };
}

function toLedgerEntry(row: LedgerRow) {
  return {
    id: row.id,
    request_id: row.requestId,
    entry_type: row.entryType,
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
    occurred_at: row.occurredAt.getTime()
  };
}

function isReportingEntry(type: string) {
  return type === "SALE_COMPLETED" || type === "COMPLIMENTARY_RECORDED" || type === "PAYMENT_RECORDED" ||
    type === "ORDER_VOIDED" || type === "ORDER_PARTIALLY_VOIDED" || type === "REFUND_RECORDED";
}

function isSaleCorrectionEntry(type: string) {
  return type === "SALE_COMPLETED" || type === "ORDER_VOIDED" || type === "ORDER_PARTIALLY_VOIDED";
}

function sum<T extends Record<K, number>, K extends keyof T>(entries: T[], key: K) {
  return entries.reduce((total, entry) => total + entry[key], 0);
}

function buildProductSales(
  entries: ReturnType<typeof toLedgerEntry>[],
  totalKey: "gross_amount" | "complimentary_value"
) {
  const grouped = new Map<string, {
    product_id: string;
    product_name: string;
    product_category: string;
    quantity: number;
    total: number;
  }>();
  for (const entry of entries) {
    if (!entry.product_id || !entry.product_name || !entry.product_category) continue;
    const key = entry.product_id + ":" + entry.product_name;
    const current = grouped.get(key);
    if (current) {
      current.quantity += entry.quantity;
      current.total += entry[totalKey];
    } else {
      grouped.set(key, {
        product_id: entry.product_id,
        product_name: entry.product_name,
        product_category: entry.product_category,
        quantity: entry.quantity,
        total: entry[totalKey]
      });
    }
  }
  return [...grouped.values()].sort((left, right) => right.total - left.total || left.product_name.localeCompare(right.product_name));
}
