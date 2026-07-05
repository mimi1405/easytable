import { randomUUID } from "node:crypto";

import { and, asc, count, eq, ne, sql } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import { layoutAreas, layoutFloors, layoutTables } from "../db/schema.js";
import type {
  LayoutAreaCreateRequest,
  LayoutAreaUpdateRequest,
  LayoutFloorCreateRequest,
  LayoutFloorUpdateRequest,
  LayoutTableCreateRequest,
  LayoutTableUpdateRequest,
  Order,
  OwnerLocation,
  Table,
  TableContext,
  TableLayout,
  TableLayoutArea,
  TableLayoutFloor,
  TableLayoutTable
} from "../types.js";
import { areas as seedAreas, floors as seedFloors, layoutTables as seedTables } from "./storeSeeds.js";
import { loadLocalSiteConfig } from "./localSiteStore.js";
import { posOrders, staffOrders } from "./storeState.js";
import type { PosOrderSnapshot } from "./storeState.js";

type LayoutFloorRow = typeof layoutFloors.$inferSelect;
type LayoutAreaRow = typeof layoutAreas.$inferSelect;
type LayoutTableRow = typeof layoutTables.$inferSelect;

export class TableLayoutError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function listOwnerLocations(): OwnerLocation[] {
  const siteConfig = loadLocalSiteConfig();
  return [siteConfig.location];
}

export function listTables(): Table[] {
  ensureTableLayoutSeeded();

  const rows = getDrizzleDatabase()
    .select({
      id: layoutTables.id,
      name: layoutTables.name,
      areaName: layoutAreas.name
    })
    .from(layoutTables)
    .innerJoin(layoutAreas, eq(layoutAreas.id, layoutTables.areaId))
    .innerJoin(layoutFloors, eq(layoutFloors.id, layoutAreas.floorId))
    .where(eq(layoutFloors.locationId, loadLocalSiteConfig().location.id))
    .orderBy(asc(layoutAreas.sortOrder), asc(layoutTables.sortOrder), asc(layoutTables.name))
    .all();

  return rows.map((table) => {
    const openOrder = findOpenOrderForTable(table.id);

    return {
      id: table.id,
      name: table.name,
      status: openOrder ? "OPEN" : "FREE",
      areaName: table.areaName
    };
  });
}

export function getTableLayout(locationId = loadLocalSiteConfig().location.id): TableLayout {
  ensureLocalLocation(locationId);
  ensureTableLayoutSeeded();

  const siteConfig = loadLocalSiteConfig();
  const floors = getDrizzleDatabase()
    .select()
    .from(layoutFloors)
    .where(eq(layoutFloors.locationId, locationId))
    .orderBy(asc(layoutFloors.sortOrder), asc(layoutFloors.name))
    .all();
  const areas = getDrizzleDatabase()
    .select()
    .from(layoutAreas)
    .innerJoin(layoutFloors, eq(layoutFloors.id, layoutAreas.floorId))
    .where(eq(layoutFloors.locationId, locationId))
    .orderBy(asc(layoutAreas.sortOrder), asc(layoutAreas.name))
    .all()
    .map((row) => row.layout_areas);
  const tables = getDrizzleDatabase()
    .select()
    .from(layoutTables)
    .innerJoin(layoutAreas, eq(layoutAreas.id, layoutTables.areaId))
    .innerJoin(layoutFloors, eq(layoutFloors.id, layoutAreas.floorId))
    .where(eq(layoutFloors.locationId, locationId))
    .orderBy(asc(layoutTables.sortOrder), asc(layoutTables.name))
    .all()
    .map((row) => row.layout_tables);

  return {
    tenant: siteConfig.tenant,
    location: siteConfig.location,
    floors: floors.map((floor) => toLayoutFloor(floor, areas, tables))
  };
}

export function createLayoutFloor(locationId: string, request: LayoutFloorCreateRequest): TableLayoutFloor {
  ensureLocalLocation(locationId);
  ensureTableLayoutSeeded();

  const now = Date.now();
  const name = normalizeName(request.name, "Floor name is required.");
  ensureUniqueFloorName(locationId, name);
  const sortOrder = normalizeOptionalInteger(request.sort_order, nextFloorSortOrder(locationId));
  const id = "floor_" + randomUUID();

  getDrizzleDatabase()
    .insert(layoutFloors)
    .values({ id, locationId, name, sortOrder, createdAt: now, updatedAt: now })
    .run();

  return requireFloor(locationId, id);
}

export function updateLayoutFloor(locationId: string, floorId: string, request: LayoutFloorUpdateRequest): TableLayoutFloor {
  ensureLocalLocation(locationId);
  ensureTableLayoutSeeded();

  const current = requireFloor(locationId, floorId);
  const name = request.name === undefined ? current.name : normalizeName(request.name, "Floor name is required.");
  const sortOrder = request.sort_order === undefined
    ? current.sort_order
    : normalizeOptionalInteger(request.sort_order, current.sort_order);

  if (name !== current.name) {
    ensureUniqueFloorName(locationId, name, floorId);
  }

  getDrizzleDatabase()
    .update(layoutFloors)
    .set({ name, sortOrder, updatedAt: Date.now() })
    .where(eq(layoutFloors.id, floorId))
    .run();

  return requireFloor(locationId, floorId);
}

export function deleteLayoutFloor(locationId: string, floorId: string) {
  ensureLocalLocation(locationId);
  ensureTableLayoutSeeded();
  requireFloor(locationId, floorId);

  const childCount = getDrizzleDatabase()
    .select({ count: count() })
    .from(layoutAreas)
    .where(eq(layoutAreas.floorId, floorId))
    .get()?.count ?? 0;

  if (childCount > 0) {
    throw new TableLayoutError("Floor still has areas assigned.", 409);
  }

  getDrizzleDatabase().delete(layoutFloors).where(eq(layoutFloors.id, floorId)).run();
}

export function createLayoutArea(locationId: string, request: LayoutAreaCreateRequest): TableLayoutArea {
  ensureLocalLocation(locationId);
  ensureTableLayoutSeeded();

  const floor = requireFloor(locationId, normalizeName(request.floor_id, "Floor is required."));
  const now = Date.now();
  const name = normalizeName(request.name, "Area name is required.");
  ensureUniqueAreaName(floor.id, name);
  const sortOrder = normalizeOptionalInteger(request.sort_order, nextAreaSortOrder(floor.id));
  const id = "area_" + randomUUID();

  getDrizzleDatabase()
    .insert(layoutAreas)
    .values({ id, floorId: floor.id, name, sortOrder, createdAt: now, updatedAt: now })
    .run();

  return requireArea(locationId, id);
}

export function updateLayoutArea(locationId: string, areaId: string, request: LayoutAreaUpdateRequest): TableLayoutArea {
  ensureLocalLocation(locationId);
  ensureTableLayoutSeeded();

  const current = requireArea(locationId, areaId);
  const floorId = request.floor_id === undefined
    ? current.floor_id
    : requireFloor(locationId, normalizeName(request.floor_id, "Floor is required.")).id;
  const name = request.name === undefined ? current.name : normalizeName(request.name, "Area name is required.");
  const sortOrder = request.sort_order === undefined
    ? current.sort_order
    : normalizeOptionalInteger(request.sort_order, current.sort_order);

  if (floorId !== current.floor_id || name !== current.name) {
    ensureUniqueAreaName(floorId, name, areaId);
  }

  getDrizzleDatabase()
    .update(layoutAreas)
    .set({ floorId, name, sortOrder, updatedAt: Date.now() })
    .where(eq(layoutAreas.id, areaId))
    .run();

  return requireArea(locationId, areaId);
}

export function deleteLayoutArea(locationId: string, areaId: string) {
  ensureLocalLocation(locationId);
  ensureTableLayoutSeeded();
  requireArea(locationId, areaId);

  const childCount = getDrizzleDatabase()
    .select({ count: count() })
    .from(layoutTables)
    .where(eq(layoutTables.areaId, areaId))
    .get()?.count ?? 0;

  if (childCount > 0) {
    throw new TableLayoutError("Area still has tables assigned.", 409);
  }

  getDrizzleDatabase().delete(layoutAreas).where(eq(layoutAreas.id, areaId)).run();
}

export function createLayoutTable(locationId: string, request: LayoutTableCreateRequest): TableLayoutTable {
  ensureLocalLocation(locationId);
  ensureTableLayoutSeeded();

  const area = requireArea(locationId, normalizeName(request.area_id, "Area is required."));
  const now = Date.now();
  const name = normalizeName(request.name, "Table name is required.");
  ensureUniqueTableName(area.id, name);
  const seats = normalizePositiveInteger(request.seats, "Seats must be a positive integer.");
  const sortOrder = normalizeOptionalInteger(request.sort_order, nextTableSortOrder(area.id));
  const id = "table_" + randomUUID();

  getDrizzleDatabase()
    .insert(layoutTables)
    .values({ id, areaId: area.id, name, seats, sortOrder, createdAt: now, updatedAt: now })
    .run();

  return toLayoutTable(requireTable(locationId, id));
}

export function updateLayoutTable(locationId: string, tableId: string, request: LayoutTableUpdateRequest): TableLayoutTable {
  ensureLocalLocation(locationId);
  ensureTableLayoutSeeded();

  const current = requireTable(locationId, tableId);
  const areaId = request.area_id === undefined
    ? current.areaId
    : requireArea(locationId, normalizeName(request.area_id, "Area is required.")).id;
  const name = request.name === undefined ? current.name : normalizeName(request.name, "Table name is required.");
  const seats = request.seats === undefined
    ? current.seats
    : normalizePositiveInteger(request.seats, "Seats must be a positive integer.");
  const sortOrder = request.sort_order === undefined
    ? current.sortOrder
    : normalizeOptionalInteger(request.sort_order, current.sortOrder);

  if (areaId !== current.areaId || name !== current.name) {
    ensureUniqueTableName(areaId, name, tableId);
  }

  getDrizzleDatabase()
    .update(layoutTables)
    .set({ areaId, name, seats, sortOrder, updatedAt: Date.now() })
    .where(eq(layoutTables.id, tableId))
    .run();

  return toLayoutTable(requireTable(locationId, tableId));
}

export function deleteLayoutTable(locationId: string, tableId: string) {
  ensureLocalLocation(locationId);
  ensureTableLayoutSeeded();
  requireTable(locationId, tableId);

  if (findOpenOrderForTable(tableId)) {
    throw new TableLayoutError("Table has an open order.", 409);
  }

  getDrizzleDatabase().delete(layoutTables).where(eq(layoutTables.id, tableId)).run();
}

export function findOpenPosOrderForTable(tableId: string, locationId?: string): PosOrderSnapshot | undefined {
  return posOrders.find(
    (order) =>
      order.table_context !== null &&
      order.table_context.table_id === tableId &&
      (!locationId || order.table_context.location_id === locationId) &&
      order.status === "OPEN" &&
      order.payment_status === "UNPAID"
  );
}

export function findOpenStaffOrderForTable(tableId: string, locationId?: string): Order | undefined {
  const expectedLocationId = locationId ?? locationIdForTable(tableId);

  return staffOrders.find(
    (order) =>
      order.tableId === tableId &&
      order.status === "OPEN" &&
      (!expectedLocationId || (order.locationId ?? locationIdForTable(order.tableId)) === expectedLocationId)
  );
}

export function tableFromContext(tableContext: TableContext, status: Table["status"]): Table {
  return {
    id: tableContext.table_id,
    name: tableContext.table_name,
    status,
    areaName: tableContext.area_name ?? ""
  };
}

function ensureTableLayoutSeeded() {
  const siteConfig = loadLocalSiteConfig();
  const row = getDrizzleDatabase()
    .select({ count: count() })
    .from(layoutFloors)
    .where(eq(layoutFloors.locationId, siteConfig.location.id))
    .get();

  if ((row?.count ?? 0) > 0) {
    return;
  }

  const now = Date.now();
  getDrizzleDatabase().transaction((tx) => {
    for (const floor of seedFloors) {
      tx.insert(layoutFloors)
        .values({
          id: floor.id,
          locationId: siteConfig.location.id,
          name: floor.name,
          sortOrder: floor.sort_order,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing()
        .run();
    }

    for (const area of seedAreas) {
      tx.insert(layoutAreas)
        .values({
          id: area.id,
          floorId: area.floor_id,
          name: area.name,
          sortOrder: area.sort_order,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing()
        .run();
    }

    for (const table of seedTables) {
      tx.insert(layoutTables)
        .values({
          id: table.id,
          areaId: table.area_id,
          name: table.name,
          seats: table.seats,
          sortOrder: table.sort_order,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing()
        .run();
    }
  });
}

function toLayoutFloor(floor: LayoutFloorRow, areas: LayoutAreaRow[], tables: LayoutTableRow[]): TableLayoutFloor {
  return {
    id: floor.id,
    location_id: floor.locationId,
    name: floor.name,
    sort_order: floor.sortOrder,
    areas: areas
      .filter((area) => area.floorId === floor.id)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
      .map((area) => ({
        id: area.id,
        floor_id: area.floorId,
        name: area.name,
        sort_order: area.sortOrder,
        tables: tables
          .filter((table) => table.areaId === area.id)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
          .map(toLayoutTable)
      }))
  };
}

function toLayoutTable(table: LayoutTableRow): TableLayoutTable {
  const openOrder = findOpenOrderForTable(table.id);

  return {
    id: table.id,
    area_id: table.areaId,
    name: table.name,
    seats: table.seats,
    sort_order: table.sortOrder,
    open_order_id: openOrder?.id ?? null,
    open_order_number: openOrder?.orderNumber ?? null,
    open_total: openOrder?.total ?? 0,
    open_order_count: openOrder ? 1 : 0
  };
}

function findOpenOrderForTable(tableId: string): { id: string; orderNumber: string; total: number } | null {
  const posOrder = findOpenPosOrderForTable(tableId);

  if (posOrder) {
    return {
      id: posOrder.id,
      orderNumber: posOrder.order_number,
      total: posOrder.total
    };
  }

  const staffOrder = findOpenStaffOrderForTable(tableId);

  if (!staffOrder) {
    return null;
  }

  return {
    id: staffOrder.id,
    orderNumber: staffOrder.orderNumber,
    total: staffOrder.total
  };
}

function requireFloor(locationId: string, floorId: string) {
  const row = getDrizzleDatabase()
    .select()
    .from(layoutFloors)
    .where(and(eq(layoutFloors.id, floorId), eq(layoutFloors.locationId, locationId)))
    .get();

  if (!row) {
    throw new TableLayoutError("Floor not found.", 404);
  }

  return {
    id: row.id,
    location_id: row.locationId,
    name: row.name,
    sort_order: row.sortOrder,
    areas: []
  };
}

function requireArea(locationId: string, areaId: string) {
  const row = getDrizzleDatabase()
    .select({
      id: layoutAreas.id,
      floorId: layoutAreas.floorId,
      name: layoutAreas.name,
      sortOrder: layoutAreas.sortOrder
    })
    .from(layoutAreas)
    .innerJoin(layoutFloors, eq(layoutFloors.id, layoutAreas.floorId))
    .where(and(eq(layoutAreas.id, areaId), eq(layoutFloors.locationId, locationId)))
    .get();

  if (!row) {
    throw new TableLayoutError("Area not found.", 404);
  }

  return {
    id: row.id,
    floor_id: row.floorId,
    name: row.name,
    sort_order: row.sortOrder,
    tables: []
  };
}

function requireTable(locationId: string, tableId: string): LayoutTableRow {
  const row = getDrizzleDatabase()
    .select({
      id: layoutTables.id,
      areaId: layoutTables.areaId,
      name: layoutTables.name,
      seats: layoutTables.seats,
      sortOrder: layoutTables.sortOrder,
      createdAt: layoutTables.createdAt,
      updatedAt: layoutTables.updatedAt
    })
    .from(layoutTables)
    .innerJoin(layoutAreas, eq(layoutAreas.id, layoutTables.areaId))
    .innerJoin(layoutFloors, eq(layoutFloors.id, layoutAreas.floorId))
    .where(and(eq(layoutTables.id, tableId), eq(layoutFloors.locationId, locationId)))
    .get();

  if (!row) {
    throw new TableLayoutError("Table not found.", 404);
  }

  return row;
}

function ensureLocalLocation(locationId: string) {
  const currentLocationId = loadLocalSiteConfig().location.id;
  if (locationId !== currentLocationId) {
    throw new TableLayoutError("Location is not managed by this Local Master.", 403);
  }
}

function ensureUniqueFloorName(locationId: string, name: string, exceptFloorId?: string) {
  const row = getDrizzleDatabase()
    .select({ id: layoutFloors.id })
    .from(layoutFloors)
    .where(and(eq(layoutFloors.locationId, locationId), sql`lower(${layoutFloors.name}) = lower(${name})`, ne(layoutFloors.id, exceptFloorId ?? "")))
    .get();

  if (row) throw new TableLayoutError("Floor name already exists.", 409);
}

function ensureUniqueAreaName(floorId: string, name: string, exceptAreaId?: string) {
  const row = getDrizzleDatabase()
    .select({ id: layoutAreas.id })
    .from(layoutAreas)
    .where(and(eq(layoutAreas.floorId, floorId), sql`lower(${layoutAreas.name}) = lower(${name})`, ne(layoutAreas.id, exceptAreaId ?? "")))
    .get();

  if (row) throw new TableLayoutError("Area name already exists.", 409);
}

function ensureUniqueTableName(areaId: string, name: string, exceptTableId?: string) {
  const row = getDrizzleDatabase()
    .select({ id: layoutTables.id })
    .from(layoutTables)
    .where(and(eq(layoutTables.areaId, areaId), sql`lower(${layoutTables.name}) = lower(${name})`, ne(layoutTables.id, exceptTableId ?? "")))
    .get();

  if (row) throw new TableLayoutError("Table name already exists.", 409);
}

function nextFloorSortOrder(locationId: string) {
  const row = getDrizzleDatabase()
    .select({ value: sql<number>`COALESCE(MAX(${layoutFloors.sortOrder}), 0) + 10` })
    .from(layoutFloors)
    .where(eq(layoutFloors.locationId, locationId))
    .get();
  return row?.value ?? 10;
}

function nextAreaSortOrder(floorId: string) {
  const row = getDrizzleDatabase()
    .select({ value: sql<number>`COALESCE(MAX(${layoutAreas.sortOrder}), 0) + 10` })
    .from(layoutAreas)
    .where(eq(layoutAreas.floorId, floorId))
    .get();
  return row?.value ?? 10;
}

function nextTableSortOrder(areaId: string) {
  const row = getDrizzleDatabase()
    .select({ value: sql<number>`COALESCE(MAX(${layoutTables.sortOrder}), 0) + 10` })
    .from(layoutTables)
    .where(eq(layoutTables.areaId, areaId))
    .get();
  return row?.value ?? 10;
}

function locationIdForTable(tableId: string) {
  ensureTableLayoutSeeded();
  const row = getDrizzleDatabase()
    .select({ locationId: layoutFloors.locationId })
    .from(layoutTables)
    .innerJoin(layoutAreas, eq(layoutAreas.id, layoutTables.areaId))
    .innerJoin(layoutFloors, eq(layoutFloors.id, layoutAreas.floorId))
    .where(eq(layoutTables.id, tableId))
    .get();

  return row?.locationId ?? null;
}

function normalizeName(value: string | undefined, message: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new TableLayoutError(message);
  return normalized;
}

function normalizeOptionalInteger(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new TableLayoutError("Sort order must be a positive integer or zero.");
  }
  return value;
}

function normalizePositiveInteger(value: number | undefined, message: string) {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    throw new TableLayoutError(message);
  }
  return value;
}
