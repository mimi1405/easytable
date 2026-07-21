import { enqueueZReportPrintJob } from "./printStore.js";
import { dayCloses, persistDayCloses } from "./storeState.js";
import { getSalesReportForWindow } from "./reportingStore.js";
import {
  appendOutboxEvent,
  beginIdempotentCommand,
  completeIdempotentCommand,
  failIdempotentCommand
} from "./commandStore.js";
import type { StoredDayClose } from "./storeState.js";
import type {
  CurrentBusinessDate,
  CurrentBusinessDateRequest,
  DayClosePreview,
  DayClosePreviewRequest,
  DayCloseProductSale,
  SaveDayCloseRequest,
  SavedDayClose
} from "../types.js";

class DayCloseConflictError extends Error {
  readonly statusCode = 409;
}

export function getCurrentBusinessDate(request: CurrentBusinessDateRequest): CurrentBusinessDate {
  return {
    business_date: currentBusinessDate(request.business_day_cutover_time)
  };
}

export function getDayClosePreview(request: DayClosePreviewRequest): DayClosePreview {
  const window = businessDayWindow(request.business_date, request.business_day_cutover_time);
  const report = getSalesReportForWindow(window.businessDate, window.startMs, window.endMs);
  const existingClose = dayCloses.get(window.businessDate);

  return {
    business_date: window.businessDate,
    business_day_cutover_time: window.cutoverTime,
    window_start_ms: window.startMs,
    window_end_ms: window.endMs,
    expected_cash: report.payment_totals.cash,
    expected_card: report.payment_totals.wallee_terminal,
    expected_total: report.gross_total,
    order_count: report.order_count,
    item_count: report.item_count,
    complimentary_quantity: report.complimentary_quantity,
    complimentary_value: report.complimentary_value,
    product_sales: report.product_sales,
    complimentary_sales: report.complimentary_sales,
    existing_close: existingClose
      ? {
          counted_cash: existingClose.counted_cash,
          cash_difference: existingClose.cash_difference,
          created_at: existingClose.created_at
        }
      : null
  };
}

export function saveDayClose(request: SaveDayCloseRequest): SavedDayClose {
  const command = beginIdempotentCommand("DAY_CLOSE_SAVE", request.request_id, {
    business_date: request.business_date,
    business_day_cutover_time: request.business_day_cutover_time,
    counted_cash: request.counted_cash,
    terminal_id: request.terminal_id ?? null
  });

  if (command.mode === "replay") {
    return command.result as SavedDayClose;
  }

  try {
    const saved = saveDayCloseUnchecked(request);
    appendOutboxEvent("DAY_CLOSE_SAVED", saved.business_date, saved);
    return completeIdempotentCommand(command.entry, saved);
  } catch (error) {
    return failIdempotentCommand(command.entry, error);
  }
}

function saveDayCloseUnchecked(request: SaveDayCloseRequest): SavedDayClose {
  if (request.counted_cash < 0) {
    throw new Error("Counted cash cannot be negative.");
  }

  const preview = getDayClosePreview({
    business_date: request.business_date,
    business_day_cutover_time: request.business_day_cutover_time
  });

  if (preview.order_count === 0) {
    throw new DayCloseConflictError(
      "No completed orders exist in the selected business-day window."
    );
  }

  const now = Date.now();
  const saved: StoredDayClose = {
    business_date: preview.business_date,
    total_cash: preview.expected_cash,
    total_card: preview.expected_card,
    counted_cash: request.counted_cash,
    cash_difference: request.counted_cash - preview.expected_cash,
    order_count: preview.order_count,
    item_count: preview.item_count,
    created_at: now,
    preview
  };

  dayCloses.set(preview.business_date, saved);
  persistDayCloses();
  enqueueZReportPrintJob(request.terminal_id, saved);

  return {
    business_date: saved.business_date,
    total_cash: saved.total_cash,
    total_card: saved.total_card,
    counted_cash: saved.counted_cash,
    cash_difference: saved.cash_difference,
    order_count: saved.order_count,
    item_count: saved.item_count,
    created_at: saved.created_at
  };
}

function currentBusinessDate(cutoverTime: string) {
  const cutoverMinutes = parseCutoverMinutes(cutoverTime);
  const now = new Date();
  const minutesAfterMidnight = now.getHours() * 60 + now.getMinutes();
  const businessDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (minutesAfterMidnight < cutoverMinutes) {
    businessDate.setDate(businessDate.getDate() - 1);
  }

  return formatLocalDate(businessDate);
}

function businessDayWindow(businessDate: string, cutoverTime: string) {
  const cutoverMinutes = parseCutoverMinutes(cutoverTime);
  const startDate = parseBusinessDate(businessDate);
  startDate.setHours(Math.floor(cutoverMinutes / 60), cutoverMinutes % 60, 0, 0);

  const endDate = new Date(startDate.getTime());
  endDate.setDate(endDate.getDate() + 1);

  return {
    businessDate,
    cutoverTime,
    startMs: startDate.getTime(),
    endMs: endDate.getTime()
  };
}

function parseBusinessDate(businessDate: string) {
  const parts = businessDate.split("-").map((part) => Number(part));

  if (
    parts.length !== 3 ||
    !Number.isInteger(parts[0]) ||
    !Number.isInteger(parts[1]) ||
    !Number.isInteger(parts[2])
  ) {
    throw new Error("Business date must use YYYY-MM-DD.");
  }

  const [year, month, day] = parts as [number, number, number];
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error("Business date must use YYYY-MM-DD.");
  }

  return parsed;
}

function parseCutoverMinutes(cutoverTime: string) {
  const [hoursText, minutesText] = cutoverTime.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
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
