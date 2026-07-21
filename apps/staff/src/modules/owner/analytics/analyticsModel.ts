import type { SalesLedgerEntry, SalesReport } from "../../../lib/local-master";

export type AnalyticsRangePreset = "today" | "yesterday" | "week" | "month" | "custom";

export type AnalyticsFilters = {
  preset: AnalyticsRangePreset;
  from: string;
  to: string;
  paymentMethod: string;
  category: string;
  terminalId: string;
  includeStornos: boolean;
};

export type AnalyticsViewModel = {
  grossTotal: number;
  taxTotal: number;
  netTotal: number;
  orderCount: number;
  itemCount: number;
  stornoTotal: number;
  complimentaryQuantity: number;
  complimentaryValue: number;
  paymentTotals: {
    cash: number;
    walleeTerminal: number;
  };
  revenueSeries: Array<{ date: string; gross: number; storno: number }>;
  paymentSeries: Array<{ method: string; total: number }>;
  productRows: Array<{
    productKey: string;
    productName: string;
    productCategory: string;
    quantity: number;
    total: number;
  }>;
  complimentaryRows: Array<{
    key: string;
    productName: string;
    actorName: string;
    quantity: number;
    value: number;
  }>;
  ledgerRows: SalesLedgerEntry[];
};

const saleEntryTypes = new Set<SalesLedgerEntry["entry_type"]>(["SALE_COMPLETED", "ORDER_VOIDED", "ORDER_PARTIALLY_VOIDED"]);

export function defaultAnalyticsFilters(now = new Date()): AnalyticsFilters {
  const today = formatDate(now);
  return {
    preset: "today",
    from: today,
    to: today,
    paymentMethod: "",
    category: "",
    terminalId: "",
    includeStornos: true
  };
}

export function rangeForPreset(preset: AnalyticsRangePreset, now = new Date()) {
  const today = startOfLocalDay(now);
  if (preset === "yesterday") {
    const yesterday = addDays(today, -1);
    return { from: formatDate(yesterday), to: formatDate(yesterday) };
  }
  if (preset === "week") {
    return { from: formatDate(addDays(today, -6)), to: formatDate(today) };
  }
  if (preset === "month") {
    return { from: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: formatDate(today) };
  }
  return { from: formatDate(today), to: formatDate(today) };
}

export function datesInRange(from: string, to: string) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (start.getTime() > end.getTime()) {
    throw new Error("Von-Datum darf nicht nach Bis-Datum liegen.");
  }

  const dates: string[] = [];
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
    dates.push(formatDate(cursor));
  }
  return dates;
}

export function buildAnalyticsViewModel(reports: SalesReport[], filters: AnalyticsFilters): AnalyticsViewModel {
  const entries = reports
    .flatMap((report) => report.entries)
    .filter((entry) => !filters.paymentMethod || entry.payment_method === filters.paymentMethod)
    .filter((entry) => !filters.terminalId || entry.terminal_id === filters.terminalId)
    .filter((entry) => !filters.category || entry.product_category === filters.category)
    .filter((entry) => filters.includeStornos || (entry.entry_type !== "ORDER_VOIDED" && entry.entry_type !== "ORDER_PARTIALLY_VOIDED" && entry.entry_type !== "REFUND_RECORDED"));
  const saleEntries = entries.filter((entry) => saleEntryTypes.has(entry.entry_type));
  const paymentEntries = entries.filter((entry) => entry.entry_type === "PAYMENT_RECORDED" || entry.entry_type === "REFUND_RECORDED");
  const stornoEntries = saleEntries.filter((entry) => entry.gross_amount < 0);
  const complimentaryEntries = entries.filter((entry) => entry.entry_type === "COMPLIMENTARY_RECORDED");
  const productRows = buildProductRows(saleEntries);

  return {
    grossTotal: sum(saleEntries, "gross_amount"),
    taxTotal: sum(saleEntries, "tax_amount"),
    netTotal: sum(saleEntries, "gross_amount") - sum(saleEntries, "tax_amount"),
    orderCount: new Set(saleEntries.filter((entry) => entry.entry_type === "SALE_COMPLETED").map((entry) => entry.order_id)).size,
    itemCount: sum(saleEntries, "quantity"),
    stornoTotal: Math.abs(sum(stornoEntries, "gross_amount")),
    complimentaryQuantity: sum(complimentaryEntries, "quantity"),
    complimentaryValue: sum(complimentaryEntries, "complimentary_value"),
    paymentTotals: {
      cash: sum(paymentEntries.filter((entry) => entry.payment_method === "CASH"), "gross_amount"),
      walleeTerminal: sum(paymentEntries.filter((entry) => entry.payment_method === "WALLEE_TERMINAL"), "gross_amount")
    },
    revenueSeries: buildRevenueSeries(saleEntries),
    paymentSeries: [
      { method: "Cash", total: sum(paymentEntries.filter((entry) => entry.payment_method === "CASH"), "gross_amount") },
      { method: "Wallee", total: sum(paymentEntries.filter((entry) => entry.payment_method === "WALLEE_TERMINAL"), "gross_amount") }
    ].filter((entry) => entry.total !== 0),
    productRows,
    complimentaryRows: buildComplimentaryRows(complimentaryEntries),
    ledgerRows: entries.sort((left, right) => right.occurred_at - left.occurred_at)
  };
}

function buildComplimentaryRows(entries: SalesLedgerEntry[]) {
  const rows = new Map<string, AnalyticsViewModel["complimentaryRows"][number]>();
  for (const entry of entries) {
    if (!entry.product_name) continue;
    const actorName = entry.actor_display_name ?? "Unbekannt";
    const key = [entry.product_id ?? entry.product_name, entry.actor_user_id ?? actorName].join(":");
    const current = rows.get(key);
    if (current) {
      current.quantity += entry.quantity;
      current.value += entry.complimentary_value;
    } else {
      rows.set(key, { key, productName: entry.product_name, actorName, quantity: entry.quantity, value: entry.complimentary_value });
    }
  }
  return Array.from(rows.values()).sort((left, right) => right.value - left.value || left.productName.localeCompare(right.productName));
}

export function availableCategories(reports: SalesReport[]) {
  return Array.from(new Set(reports.flatMap((report) => report.entries.map((entry) => entry.product_category).filter(Boolean) as string[]))).sort();
}

function buildProductRows(entries: SalesLedgerEntry[]) {
  const rows = new Map<string, AnalyticsViewModel["productRows"][number]>();
  for (const entry of entries) {
    if (!entry.product_id || !entry.product_name || !entry.product_category) continue;
    const productKey = [entry.product_id, entry.product_name, entry.product_category].join(":");
    const existing = rows.get(productKey);
    if (existing) {
      existing.quantity += entry.quantity;
      existing.total += entry.gross_amount;
    } else {
      rows.set(productKey, {
        productKey,
        productName: entry.product_name,
        productCategory: entry.product_category,
        quantity: entry.quantity,
        total: entry.gross_amount
      });
    }
  }
  return Array.from(rows.values()).sort((left, right) => right.total - left.total || left.productName.localeCompare(right.productName));
}

function buildRevenueSeries(entries: SalesLedgerEntry[]) {
  const rows = new Map<string, { date: string; gross: number; storno: number }>();
  for (const entry of entries) {
    const current = rows.get(entry.business_date) ?? { date: entry.business_date, gross: 0, storno: 0 };
    current.gross += entry.gross_amount;
    if (entry.gross_amount < 0) {
      current.storno += Math.abs(entry.gross_amount);
    }
    rows.set(entry.business_date, current);
  }
  return Array.from(rows.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function sum<T extends Record<K, number>, K extends keyof T>(items: T[], key: K) {
  return items.reduce((total, item) => total + item[key], 0);
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
