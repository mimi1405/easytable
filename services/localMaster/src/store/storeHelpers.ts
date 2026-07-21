import type { BasketLine, PaymentResult } from "../types.js";
import type { PosOrderSnapshot, StoredDayClose } from "./storeState.js";

const ESC = "\x1b";
const ESC_POS_INIT = ESC + "@";
const ESC_POS_NORMAL = ESC + "!" + "\x00";
const ESC_POS_BOLD_ON = ESC + "E" + "\x01";
const ESC_POS_BOLD_OFF = ESC + "E" + "\x00";
const ESC_POS_LARGE = ESC + "!" + String.fromCharCode(0x38);
const ESC_POS_ITEM = ESC + "!" + String.fromCharCode(0x28);

export function scopedId(prefix: string, timestamp: number, index: number) {
  return prefix + "_" + timestamp + "_" + index;
}

export function normalizeOptionalText(value: string | null | undefined, fallback: string | null) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value?.trim() ?? "";

  return normalized.length > 0 ? normalized : null;
}

export function cloneBasketLines(lines: BasketLine[]) {
  return lines.map((line) => {
    const complimentaryQuantity = Number.isInteger(line.complimentary_quantity)
      ? Math.max(0, Math.min(line.quantity, line.complimentary_quantity))
      : 0;
    return {
      ...line,
      complimentary_quantity: complimentaryQuantity,
      complimentary_value: line.unit_total * complimentaryQuantity,
      line_total: line.unit_total * (line.quantity - complimentaryQuantity),
      variants: line.variants.map((variant) => ({ ...variant }))
    };
  });
}

export function kdsTicketId(orderId: string, station: string) {
  return "kds_" + orderId + "_" + station.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function stationPrintJobId(orderId: string, stationId: string) {
  return "print_station_" + orderId + "_" + stationId.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function printJobId(source: string, entityId: string, targetId: string) {
  return "print_" + source + "_" + entityId + "_" + targetId.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function formatStationPrintBody(order: PosOrderSnapshot, _station: string, lines: BasketLine[]) {
  const separator = "------------------------";

  return [
    ESC_POS_INIT,
    largeLine("#" + order.order_number),
    largeLine(orderLocationLabel(order).toUpperCase()),
    ESC_POS_NORMAL + formatStationTimestamp(),
    separator,
    "",
    ...lines.flatMap(formatStationPrintLine),
    separator,
    ESC_POS_NORMAL
  ].join("\n");
}

export function stripEscPosControlCodes(value: string) {
  return value
    .replace(/\x1b@/g, "")
    .replace(/\x1b!./g, "")
    .replace(/\x1bE./g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatReceiptPrintBody(order: PosOrderSnapshot, payment: PaymentResult) {
  return [
    "EasyTable Beleg",
    "Auftrag: " + order.order_number,
    orderLocationLabel(order),
    "Zeit: " + new Date(payment.paid_at).toLocaleString("de-CH"),
    "",
    ...order.lines.map((line) => {
      const variants = line.variants.map((variant) => variant.variant_item_name).join(", ");
      const chargedQuantity = line.quantity - line.complimentary_quantity;
      return [
        String(line.quantity) + "x " + line.product_name + (variants ? " (" + variants + ")" : "") + "  " + formatMoney(line.line_total),
        ...(line.complimentary_quantity > 0
          ? ["  " + String(chargedQuantity) + " berechnet / " + String(line.complimentary_quantity) + " offeriert (" + formatMoney(line.complimentary_value) + ")"]
          : [])
      ].join("\n");
    }),
    "",
    "Zwischensumme: " + formatMoney(order.subtotal),
    "MwSt: " + formatMoney(order.tax_total),
    "Total: " + formatMoney(order.total),
    "Zahlung: " + payment.payment_method,
    ...(payment.received_cash !== null ? ["Erhalten: " + formatMoney(payment.received_cash)] : []),
    ...(payment.change_given !== null ? ["Rueckgeld: " + formatMoney(payment.change_given)] : [])
  ].join("\n");
}

export function orderLocationLabel(order: PosOrderSnapshot) {
  return order.table_context ? "Tisch: " + order.table_context.table_name : "Counter";
}

export function formatZReportPrintBody(dayClose: StoredDayClose) {
  return [
    "EasyTable Z-Bon",
    "Geschaeftstag: " + dayClose.business_date,
    "Erstellt: " + new Date(dayClose.created_at).toLocaleString("de-CH"),
    "",
    "Bar erwartet: " + formatMoney(dayClose.total_cash),
    "Karte: " + formatMoney(dayClose.total_card),
    "Total: " + formatMoney(dayClose.total_cash + dayClose.total_card),
    "Gezaehlt: " + formatMoney(dayClose.counted_cash),
    "Differenz: " + formatMoney(dayClose.cash_difference),
    "Auftraege: " + String(dayClose.order_count),
    "Artikel: " + String(dayClose.item_count),
    "Offeriert: " + String(dayClose.preview.complimentary_quantity) + " / " + formatMoney(dayClose.preview.complimentary_value),
    "",
    "Produktverkaeufe",
    ...dayClose.preview.product_sales.map(
      (sale) => String(sale.quantity) + "x " + sale.product_name + "  " + formatMoney(sale.total)
    ),
    "",
    "Offerierte Produkte",
    ...dayClose.preview.complimentary_sales.map(
      (sale) => String(sale.quantity) + "x " + sale.product_name + "  " + formatMoney(sale.total)
    )
  ].join("\n");
}

export function formatMoney(value: number) {
  return "CHF " + (value / 100).toFixed(2);
}

function largeLine(value: string) {
  return ESC_POS_LARGE + ESC_POS_BOLD_ON + value + ESC_POS_BOLD_OFF + ESC_POS_NORMAL;
}

function itemLine(value: string) {
  return ESC_POS_ITEM + ESC_POS_BOLD_ON + value + ESC_POS_BOLD_OFF + ESC_POS_NORMAL;
}

function formatStationPrintLine(line: BasketLine) {
  const productLine = itemLine(String(line.quantity) + "x " + line.product_name.toUpperCase());
  const variantLines = line.variants.map((variant) => "   + " + variant.variant_item_name);

  return [productLine, ...variantLines, ""];
}

function formatStationTimestamp() {
  return new Date().toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
