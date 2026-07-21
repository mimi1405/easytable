import { readState, writeState } from "../statePersistence.js";

import type {
  BasketLine,
  DayClosePreview,
  KdsTicket,
  LocalDevice,
  Order,
  PosDeviceBinding,
  PrintJob,
  PrintLog,
  SavedDayClose,
  StationDeviceBinding,
  StationPickup,
  TableContext,
  OrderActor
} from "../types.js";

export type PaymentLifecycleState =
  | "payment_started"
  | "provider_pending"
  | "provider_authorized"
  | "provider_completed"
  | "local_recorded"
  | "receipt_pending"
  | "receipt_queued"
  | "completed"
  | "declined"
  | "cancelled"
  | "failed"
  | "reversal_required"
  | "reconciliation_required";

export type LocalPayment = {
  id: string;
  paymentAttemptId?: string | null;
  requestId?: string;
  orderId: string;
  orderNumber?: string;
  terminalId?: string | null;
  amount: number;
  receivedCash?: number | null;
  changeGiven?: number | null;
  method: string;
  status: "COMPLETED" | "FAILED" | string;
  provider?: string;
  providerTransactionId?: string | null;
  providerStatus?: string;
  lifecycleState?: PaymentLifecycleState;
  receiptPrintJobId?: string | null;
  failureReason?: string | null;
  reconciliationRequired?: boolean;
  createdAt: number;
  updatedAt?: number;
  completedAt?: number | null;
};

export type StoredDayClose = SavedDayClose & {
  preview: DayClosePreview;
};

export type OrderSnapshotPayment = {
  payment_id: string;
  request_id: string;
  method: string;
  amount: number;
  terminal_id: string | null;
  provider: string;
  provider_transaction_id: string | null;
  provider_status: string;
  lifecycle_state: string;
  paid_at: number;
};

export type FinalOrderSnapshot = {
  id: string;
  order_id: string;
  order_number: string;
  snapshot_type: "PAID" | "COMPLIMENTARY";
  table_context: TableContext | null;
  lines: BasketLine[];
  subtotal: number;
  tax_total: number;
  total: number;
  payment: OrderSnapshotPayment;
  actor: OrderActor | null;
  terminal_id: string | null;
  business_date: string;
  created_at: number;
};

export type SalesLedgerEntryType =
  | "SALE_COMPLETED"
  | "COMPLIMENTARY_RECORDED"
  | "PAYMENT_RECORDED"
  | "ORDER_VOIDED"
  | "ORDER_PARTIALLY_VOIDED"
  | "REFUND_RECORDED";

export type SalesLedgerEntry = {
  id: string;
  request_id: string;
  entry_type: SalesLedgerEntryType;
  order_id: string;
  order_number: string;
  payment_id: string | null;
  original_entry_id: string | null;
  line_id: string | null;
  product_id: string | null;
  product_name: string | null;
  product_category: string | null;
  tax_code_id: string | null;
  tax_rate_bps: number;
  quantity: number;
  gross_amount: number;
  tax_amount: number;
  complimentary_value: number;
  actor_user_id: string | null;
  actor_display_name: string | null;
  actor_role: string | null;
  actor_device_id: string | null;
  payment_method: string | null;
  terminal_id: string | null;
  provider: string | null;
  provider_transaction_id: string | null;
  provider_refund_id: string | null;
  provider_status: string | null;
  reason: string | null;
  business_date: string;
  occurred_at: number;
};

export type PosOrderSnapshot = {
  id: string;
  order_number: string;
  table_context: TableContext | null;
  lines: BasketLine[];
  subtotal: number;
  tax_total: number;
  total: number;
  actor?: OrderActor | null;
  status: "OPEN" | "CLOSED";
  payment_status: "UNPAID" | "PAID" | "COMPLIMENTARY";
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

export const staffOrders = readState<Order[]>("staffOrders", []);
export const posOrders = readState<PosOrderSnapshot[]>("posOrders", []);
export const kdsTickets = readState<KdsTicket[]>("kdsTickets", []);
export const stationPickups = readState<StationPickup[]>("stationPickups", []);
export const payments = readState<LocalPayment[]>("payments", []);
export const orderSnapshots = readState<FinalOrderSnapshot[]>("orderSnapshots", []);
export const salesLedgerEntries = readState<SalesLedgerEntry[]>("salesLedgerEntries", []);
export const dayCloses = new Map<string, StoredDayClose>(
  readState<Array<[string, StoredDayClose]>>("dayCloses", [])
);
export const stationDeviceBindings = new Map<string, StationDeviceBinding>(
  readState<Array<[string, StationDeviceBinding]>>("stationDeviceBindings", [])
);
export const localDevices = new Map<string, LocalDevice>(
  readState<Array<[string, LocalDevice]>>("localDevices", [])
);
export const posDeviceBindings = new Map<string, PosDeviceBinding>(
  readState<Array<[string, PosDeviceBinding]>>("posDeviceBindings", [])
);
export const printLogs = readState<PrintLog[]>("printLogs", []);
export const printJobs = readState<PrintJob[]>("stationPrintJobs", []);

export function persistStaffOrders() {
  writeState("staffOrders", staffOrders);
}

export function persistPosOrders() {
  writeState("posOrders", posOrders);
}

export function persistKdsTickets() {
  writeState("kdsTickets", kdsTickets);
}

export function persistStationPickups() {
  writeState("stationPickups", stationPickups);
}

export function persistPayments() {
  writeState("payments", payments);
}

export function persistOrderSnapshots() {
  writeState("orderSnapshots", orderSnapshots);
}

export function persistSalesLedgerEntries() {
  writeState("salesLedgerEntries", salesLedgerEntries);
}

export function persistDayCloses() {
  writeState("dayCloses", Array.from(dayCloses.entries()));
}

export function persistStationDeviceBindings() {
  writeState("stationDeviceBindings", Array.from(stationDeviceBindings.entries()));
}

export function persistLocalDevices() {
  writeState("localDevices", Array.from(localDevices.entries()));
}

export function persistPosDeviceBindings() {
  writeState("posDeviceBindings", Array.from(posDeviceBindings.entries()));
}

export function persistPrintLogs() {
  writeState("printLogs", printLogs);
}

export function persistStationPrintJobs() {
  writeState("stationPrintJobs", printJobs);
}
