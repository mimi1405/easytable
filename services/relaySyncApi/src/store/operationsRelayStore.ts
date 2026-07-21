import { and, asc, eq, inArray } from "drizzle-orm";
import type { IncomingHttpHeaders } from "node:http";

import { getDrizzleDatabase } from "../db/client.js";
import { kdsTickets, orderItems, orders, stationPickups } from "../db/schema.js";
import { broadcastRelayLocationEvent } from "../lib/realtime.js";
import type {
  BasketLine,
  KdsTicket,
  KdsTicketStatus,
  LocalMasterOperationsSnapshot,
  OpenTableOrderBasket,
  StationPickup,
  StationPickupStatus
} from "../types.js";
import { ApiError } from "./errors.js";
import { requireLocalMasterCredential } from "./provisioningStore.js";
import { requireRelayLocation, requireStaffSession } from "./staffRelayStore.js";

type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;
type StationPickupRow = typeof stationPickups.$inferSelect;
type KdsTicketRow = typeof kdsTickets.$inferSelect;

export async function replaceLocalMasterOperations(
  relayToken: string,
  snapshot: LocalMasterOperationsSnapshot
): Promise<{ ok: true; open_order_count: number; station_pickup_count: number }> {
  const credential = await requireLocalMasterCredential(relayToken);
  const now = new Date();
  const openOrders = snapshot.open_table_baskets.map((entry) => ({
    id: required(entry.basket.order_id, "Order id is required."),
    tenantId: credential.tenantId,
    locationId: credential.locationId,
    localMasterInstanceId: credential.localMasterInstanceId,
    orderNumber: required(entry.basket.order_number, "Order number is required."),
    serviceMode: "TABLE_SERVICE",
    source: "LOCAL_MASTER",
    status: "OPEN",
    subtotal: integer(entry.subtotal, "Order subtotal is invalid."),
    taxTotal: integer(entry.tax_total, "Order tax total is invalid."),
    total: integer(entry.total, "Order total is invalid."),
    paymentStatus: "UNPAID",
    openedAt: toDate(entry.opened_at),
    closedAt: null,
    createdAt: now,
    updatedAt: now
  }));
  const openOrderItems = snapshot.open_table_baskets.flatMap((entry) =>
    entry.basket.lines.map((line, index) => ({
      id: entry.basket.order_id + ":" + sanitizeIdPart(line.id || String(index)),
      tenantId: credential.tenantId,
      orderId: entry.basket.order_id,
      productId: line.product_id || null,
      productType: line.product_type,
      productName: required(line.product_name, "Order item product name is required."),
      productCategory: line.product_category || "",
      quantity: integer(line.quantity, "Order item quantity is invalid."),
      unitPrice: integer(line.unit_total, "Order item unit price is invalid."),
      taxCodeId: line.tax_code_id || null,
      taxCodeName: line.tax_code_name || "",
      taxRateBps: integer(line.tax_rate_bps, "Order item tax rate is invalid."),
      taxAmount: includedTax(line.line_total, line.tax_rate_bps),
      totalPrice: integer(line.line_total, "Order item total is invalid."),
      station: line.station || null,
      notes: JSON.stringify({
        basket_line_id: line.id,
        base_price: line.base_price,
        table_id: entry.table_id,
        variants: line.variants ?? []
      }),
      createdAt: now,
      updatedAt: now
    }))
  );
  const pickupRows = snapshot.station_pickups.map((pickup) => ({
    id: required(pickup.id, "Pickup id is required."),
    tenantId: credential.tenantId,
    locationId: credential.locationId,
    orderId: required(pickup.order_id, "Pickup order id is required."),
    orderNumber: required(pickup.order_number, "Pickup order number is required."),
    tableId: required(pickup.table_id, "Pickup table id is required."),
    tableName: required(pickup.table_name, "Pickup table name is required."),
    station: required(pickup.station, "Pickup station is required."),
    status: normalizePickupStatus(pickup.status),
    itemsJson: pickup.items,
    readyAt: toDate(pickup.ready_at),
    acknowledgedAt: pickup.acknowledged_at ? toDate(pickup.acknowledged_at) : null,
    createdAt: now,
    updatedAt: now
  }));
  const kdsRows = (snapshot.kds_tickets ?? []).map((ticket) => ({
    id: required(ticket.id, "KDS ticket id is required."),
    tenantId: credential.tenantId,
    locationId: credential.locationId,
    orderId: required(ticket.order_id, "KDS ticket order id is required."),
    orderNumber: required(ticket.order_number, "KDS ticket order number is required."),
    tableId: required(ticket.table_id, "KDS ticket table id is required."),
    tableName: required(ticket.table_name, "KDS ticket table name is required."),
    station: required(ticket.station, "KDS ticket station is required."),
    status: normalizeKdsStatus(ticket.status),
    itemsJson: ticket.items,
    doneAt: ticket.done_at ? toDate(ticket.done_at) : null,
    createdAt: toDate(ticket.created_at),
    updatedAt: toDate(ticket.updated_at)
  }));

  await getDrizzleDatabase().transaction(async (tx) => {
    const existingOrders = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(
        eq(orders.tenantId, credential.tenantId),
        eq(orders.locationId, credential.locationId),
        eq(orders.localMasterInstanceId, credential.localMasterInstanceId),
        eq(orders.status, "OPEN")
      ));
    const existingOrderIds = existingOrders.map((order) => order.id);

    if (existingOrderIds.length > 0) {
      await tx.delete(orderItems).where(and(eq(orderItems.tenantId, credential.tenantId), inArray(orderItems.orderId, existingOrderIds)));
      await tx.delete(orders).where(and(eq(orders.tenantId, credential.tenantId), inArray(orders.id, existingOrderIds)));
    }

    await tx.delete(stationPickups).where(and(eq(stationPickups.tenantId, credential.tenantId), eq(stationPickups.locationId, credential.locationId)));
    await tx.delete(kdsTickets).where(and(eq(kdsTickets.tenantId, credential.tenantId), eq(kdsTickets.locationId, credential.locationId)));

    if (openOrders.length > 0) {
      await tx.insert(orders).values(openOrders);
    }

    if (openOrderItems.length > 0) {
      await tx.insert(orderItems).values(openOrderItems);
    }

    if (pickupRows.length > 0) {
      await tx.insert(stationPickups).values(pickupRows);
    }

    if (kdsRows.length > 0) {
      await tx.insert(kdsTickets).values(kdsRows);
    }
  });

  const result = {
    ok: true,
    open_order_count: openOrders.length,
    station_pickup_count: pickupRows.length
  } as const;
  broadcastRelayLocationEvent(credential.tenantId, credential.locationId, {
    type: "OPERATIONS_UPDATED",
    payload: result,
  });
  broadcastRelayLocationEvent(credential.tenantId, credential.locationId, {
    type: "TABLE_UPDATED",
    payload: result,
  });
  broadcastRelayLocationEvent(credential.tenantId, credential.locationId, {
    type: "ORDER_CREATED",
    payload: result,
  });
  broadcastRelayLocationEvent(credential.tenantId, credential.locationId, {
    type: "KDS_TICKET_UPDATED",
    payload: result,
  });
  broadcastRelayLocationEvent(credential.tenantId, credential.locationId, {
    type: "STATION_PICKUP_UPDATED",
    payload: result,
  });
  broadcastRelayLocationEvent(credential.tenantId, credential.locationId, {
    type: "STATION_PICKUP_READY",
    payload: result,
  });
  broadcastRelayLocationEvent(credential.tenantId, credential.locationId, {
    type: "STATION_PICKUP_ACKNOWLEDGED",
    payload: result,
  });
  return result;
}

export async function getRelayOpenTableOrderBasket(
  headers: IncomingHttpHeaders,
  locationId: string,
  tableId: string
): Promise<OpenTableOrderBasket | null> {
  const session = await requireStaffSession(headers, locationId);

  await requireRelayLocation(session.tenant_id, locationId);
  const order = await findOpenTableOrder(session.tenant_id, locationId, tableId);
  if (!order) {
    return null;
  }

  return {
    order_id: order.id,
    order_number: order.orderNumber,
    lines: await listBasketLines(session.tenant_id, order.id)
  };
}

export async function listRelayStationPickups(
  headers: IncomingHttpHeaders,
  locationId: string,
  status: StationPickupStatus | "ALL" = "READY"
): Promise<StationPickup[]> {
  const session = await requireStaffSession(headers, locationId);

  await requireRelayLocation(session.tenant_id, locationId);
  const where = status === "ALL"
    ? and(eq(stationPickups.tenantId, session.tenant_id), eq(stationPickups.locationId, locationId))
    : and(eq(stationPickups.tenantId, session.tenant_id), eq(stationPickups.locationId, locationId), eq(stationPickups.status, status));
  const rows = await getDrizzleDatabase()
    .select()
    .from(stationPickups)
    .where(where)
    .orderBy(asc(stationPickups.readyAt), asc(stationPickups.station));

  return rows.map(toStationPickup);
}

export async function listRelayKdsTickets(
  headers: IncomingHttpHeaders,
  locationId: string,
  station?: string
): Promise<KdsTicket[]> {
  const session = await requireStaffSession(headers, locationId);

  await requireRelayLocation(session.tenant_id, locationId);
  const normalizedStation = station?.trim() ?? "";
  const where = normalizedStation
    ? and(eq(kdsTickets.tenantId, session.tenant_id), eq(kdsTickets.locationId, locationId), eq(kdsTickets.station, normalizedStation))
    : and(eq(kdsTickets.tenantId, session.tenant_id), eq(kdsTickets.locationId, locationId));
  const rows = await getDrizzleDatabase()
    .select()
    .from(kdsTickets)
    .where(where)
    .orderBy(asc(kdsTickets.createdAt), asc(kdsTickets.orderNumber));

  return rows.map(toKdsTicket);
}

export async function findOpenTableOrder(tenantId: string, locationId: string, tableId: string): Promise<OrderRow | null> {
  const rows = await getDrizzleDatabase()
    .select()
    .from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.locationId, locationId),
      eq(orders.status, "OPEN"),
      eq(orders.paymentStatus, "UNPAID")
    ))
    .orderBy(asc(orders.openedAt));

  for (const order of rows) {
    const items = await getDrizzleDatabase()
      .select({ notes: orderItems.notes })
      .from(orderItems)
      .where(and(eq(orderItems.tenantId, tenantId), eq(orderItems.orderId, order.id)));

    if (items.some((item) => parseItemNote(item.notes).table_id === tableId)) {
      return order;
    }
  }

  return null;
}

export async function listBasketLines(tenantId: string, orderId: string): Promise<BasketLine[]> {
  const rows = await getDrizzleDatabase()
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.tenantId, tenantId), eq(orderItems.orderId, orderId)))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));

  return rows.map(toBasketLine);
}

function toBasketLine(row: OrderItemRow): BasketLine {
  const note = parseItemNote(row.notes);

  return {
    id: note.basket_line_id ?? row.id,
    product_id: row.productId ?? "",
    product_type: row.productType as "BASIC" | "SERVICE",
    product_name: row.productName,
    product_category: row.productCategory,
    base_price: note.base_price ?? row.unitPrice,
    tax_code_id: row.taxCodeId ?? "",
    tax_code_name: row.taxCodeName,
    tax_rate_bps: row.taxRateBps,
    station: row.station ?? "",
    variants: note.variants,
    unit_total: row.unitPrice,
    quantity: row.quantity,
    complimentary_quantity: 0,
    complimentary_value: 0,
    line_total: row.totalPrice
  };
}

function toStationPickup(row: StationPickupRow): StationPickup {
  return {
    id: row.id,
    order_id: row.orderId,
    order_number: row.orderNumber,
    table_id: row.tableId,
    table_name: row.tableName,
    station: row.station,
    status: row.status as StationPickupStatus,
    items: Array.isArray(row.itemsJson) ? row.itemsJson as StationPickup["items"] : [],
    ready_at: row.readyAt.getTime(),
    acknowledged_at: row.acknowledgedAt?.getTime() ?? null
  };
}

function toKdsTicket(row: KdsTicketRow): KdsTicket {
  return {
    id: row.id,
    order_id: row.orderId,
    order_number: row.orderNumber,
    table_id: row.tableId,
    table_name: row.tableName,
    station: row.station,
    status: row.status as KdsTicketStatus,
    items: Array.isArray(row.itemsJson) ? row.itemsJson as KdsTicket["items"] : [],
    created_at: row.createdAt.getTime(),
    updated_at: row.updatedAt.getTime(),
    done_at: row.doneAt?.getTime() ?? null
  };
}

function parseItemNote(value: string | null): { basket_line_id?: string; base_price?: number; variants: BasketLine["variants"]; table_id?: string } {
  if (!value) {
    return { variants: [] };
  }

  try {
    const parsed = JSON.parse(value) as Partial<ReturnType<typeof parseItemNote>>;
    return {
      basket_line_id: typeof parsed.basket_line_id === "string" ? parsed.basket_line_id : undefined,
      base_price: typeof parsed.base_price === "number" ? parsed.base_price : undefined,
      variants: Array.isArray(parsed.variants) ? parsed.variants : [],
      table_id: typeof parsed.table_id === "string" ? parsed.table_id : undefined
    };
  } catch {
    return { variants: [] };
  }
}

function required(value: string | undefined | null, message: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new ApiError(message, 400);
  return normalized;
}

function integer(value: number, message: string) {
  if (!Number.isInteger(value) || value < 0) throw new ApiError(message, 400);
  return value;
}

function toDate(value: number) {
  if (!Number.isFinite(value)) {
    throw new ApiError("Timestamp is invalid.", 400);
  }
  return new Date(value);
}

function normalizePickupStatus(value: string) {
  if (value !== "READY" && value !== "ACKNOWLEDGED") {
    throw new ApiError("Pickup status is invalid.", 400);
  }
  return value;
}

function normalizeKdsStatus(value: string) {
  if (value !== "OPEN" && value !== "IN_PROGRESS" && value !== "DONE") {
    throw new ApiError("KDS ticket status is invalid.", 400);
  }
  return value;
}

function sanitizeIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 120) || "line";
}

function includedTax(grossAmount: number, taxRateBps: number) {
  if (taxRateBps <= 0) {
    return 0;
  }

  return Math.round((grossAmount * taxRateBps) / (10_000 + taxRateBps));
}
