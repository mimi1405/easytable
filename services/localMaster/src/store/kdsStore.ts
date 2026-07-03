import { listCatalogOutputStations } from "../catalogStore.js";
import { kdsTickets, persistKdsTickets } from "./storeState.js";
import { kdsTicketId } from "./storeHelpers.js";
import { createStationPickupFromKdsTicket } from "./stationPickupStore.js";
import type { PosOrderSnapshot } from "./storeState.js";
import type { BasketLine, KdsTicket, KdsTicketStatus } from "../types.js";

export function listKdsTickets(station?: string) {
  const normalizedStation = station?.trim();

  return kdsTickets
    .filter((ticket) => !normalizedStation || ticket.station === normalizedStation)
    .slice()
    .sort((left, right) => left.created_at - right.created_at || left.order_number.localeCompare(right.order_number));
}

export function updateKdsTicketStatus(ticketId: string, status: KdsTicketStatus) {
  const ticket = kdsTickets.find((entry) => entry.id === ticketId);

  if (!ticket) {
    throw new Error("KDS ticket not found.");
  }

  if (!isKdsTicketStatus(status)) {
    throw new Error("KDS ticket status is invalid.");
  }

  const now = Date.now();
  ticket.status = status;
  ticket.updated_at = now;
  ticket.done_at = status === "DONE" ? now : null;
  persistKdsTickets();

  const pickup = status === "DONE" ? createStationPickupFromKdsTicket(ticket) : null;

  return { ticket, pickup };
}

export function rebuildKdsTicketsForOrder(order: PosOrderSnapshot) {
  const now = Date.now();
  const groupedLines = new Map<string, BasketLine[]>();
  const kdsStationNames = new Set(
    listCatalogOutputStations()
      .filter((station) => station.is_active && station.has_kds)
      .map((station) => station.name)
  );
  const created: KdsTicket[] = [];
  const updated: KdsTicket[] = [];

  for (const line of order.lines) {
    const station = line.station.trim();

    if (!station || !kdsStationNames.has(station)) {
      continue;
    }

    const lines = groupedLines.get(station) ?? [];
    lines.push(line);
    groupedLines.set(station, lines);
  }

  for (const [station, lines] of groupedLines.entries()) {
    const ticketId = kdsTicketId(order.id, station);
    const existingTicket = kdsTickets.find((ticket) => ticket.id === ticketId);
    const items = lines.map((line) => ({
      product_id: line.product_id,
      product_name: line.product_name,
      quantity: line.quantity,
      variants: line.variants.map((variant) => ({ ...variant }))
    }));

    if (existingTicket) {
      existingTicket.order_number = order.order_number;
      existingTicket.table_id = order.table_context?.table_id ?? "counter";
      existingTicket.table_name = order.table_context?.table_name ?? "Counter";
      existingTicket.items = items;
      existingTicket.updated_at = now;
      existingTicket.done_at = existingTicket.status === "DONE" ? existingTicket.done_at : null;
      updated.push(existingTicket);
    } else {
      const ticket: KdsTicket = {
        id: ticketId,
        order_id: order.id,
        order_number: order.order_number,
        table_id: order.table_context?.table_id ?? "counter",
        table_name: order.table_context?.table_name ?? "Counter",
        station,
        status: "OPEN",
        items,
        created_at: now,
        updated_at: now,
        done_at: null
      };

      kdsTickets.push(ticket);
      created.push(ticket);
    }
  }

  for (let index = kdsTickets.length - 1; index >= 0; index -= 1) {
    const ticket = kdsTickets[index];

    if (ticket.order_id === order.id && !groupedLines.has(ticket.station)) {
      kdsTickets.splice(index, 1);
    }
  }

  persistKdsTickets();

  return { created, updated };
}

function isKdsTicketStatus(value: string): value is KdsTicketStatus {
  return value === "OPEN" || value === "IN_PROGRESS" || value === "DONE";
}
