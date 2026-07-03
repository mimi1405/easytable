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
  TableContext
} from "../types.js";

export type LocalPayment = {
  id: string;
  orderId: string;
  amount: number;
  method: string;
  status: "COMPLETED";
  createdAt: number;
};

export type StoredDayClose = SavedDayClose & {
  preview: DayClosePreview;
};

export type PosOrderSnapshot = {
  id: string;
  order_number: string;
  table_context: TableContext | null;
  lines: BasketLine[];
  subtotal: number;
  tax_total: number;
  total: number;
  status: "OPEN" | "CLOSED";
  payment_status: "UNPAID" | "PAID";
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

export const staffOrders = readState<Order[]>("staffOrders", []);
export const posOrders = readState<PosOrderSnapshot[]>("posOrders", []);
export const kdsTickets = readState<KdsTicket[]>("kdsTickets", []);
export const stationPickups = readState<StationPickup[]>("stationPickups", []);
export const payments = readState<LocalPayment[]>("payments", []);
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
