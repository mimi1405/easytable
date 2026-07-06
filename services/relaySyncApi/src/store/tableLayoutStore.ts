import { and, asc, eq } from "drizzle-orm";
import type { IncomingHttpHeaders } from "node:http";

import { getDrizzleDatabase } from "../db/client.js";
import { layoutAreas, layoutFloors, layoutTables, locations, tenants } from "../db/schema.js";
import type { TableLayout } from "../types.js";
import { ApiError } from "./errors.js";
import { findOpenTableOrder } from "./operationsRelayStore.js";
import { requireLocalMasterCredential } from "./provisioningStore.js";
import { requireStaffSession } from "./staffRelayStore.js";

type FloorRow = typeof layoutFloors.$inferSelect;
type AreaRow = typeof layoutAreas.$inferSelect;
type TableRow = typeof layoutTables.$inferSelect;

export async function replaceLocalMasterTableLayout(relayToken: string, snapshot: TableLayout): Promise<TableLayout> {
  const credential = await requireLocalMasterCredential(relayToken);
  validateSnapshotForCredential(snapshot, credential.tenantId, credential.locationId);

  const now = new Date();
  const floorRows = snapshot.floors.map((floor) => ({
    id: normalizeRequiredText(floor.id, "Floor id is required."),
    tenantId: credential.tenantId,
    locationId: credential.locationId,
    name: normalizeRequiredText(floor.name, "Floor name is required."),
    sortOrder: normalizeSortOrder(floor.sort_order),
    createdAt: now,
    updatedAt: now
  }));
  const areaRows = snapshot.floors.flatMap((floor) =>
    floor.areas.map((area) => ({
      id: normalizeRequiredText(area.id, "Area id is required."),
      tenantId: credential.tenantId,
      locationId: credential.locationId,
      floorId: normalizeRequiredText(area.floor_id || floor.id, "Area floor id is required."),
      name: normalizeRequiredText(area.name, "Area name is required."),
      sortOrder: normalizeSortOrder(area.sort_order),
      createdAt: now,
      updatedAt: now
    }))
  );
  const tableRows = snapshot.floors.flatMap((floor) =>
    floor.areas.flatMap((area) =>
      area.tables.map((table) => ({
        id: normalizeRequiredText(table.id, "Table id is required."),
        tenantId: credential.tenantId,
        locationId: credential.locationId,
        areaId: normalizeRequiredText(table.area_id || area.id, "Table area id is required."),
        name: normalizeRequiredText(table.name, "Table name is required."),
        seats: normalizePositiveInteger(table.seats, "Seats must be a positive integer."),
        sortOrder: normalizeSortOrder(table.sort_order),
        createdAt: now,
        updatedAt: now
      }))
    )
  );

  await getDrizzleDatabase().transaction(async (tx) => {
    await tx.delete(layoutTables).where(and(eq(layoutTables.tenantId, credential.tenantId), eq(layoutTables.locationId, credential.locationId)));
    await tx.delete(layoutAreas).where(and(eq(layoutAreas.tenantId, credential.tenantId), eq(layoutAreas.locationId, credential.locationId)));
    await tx.delete(layoutFloors).where(and(eq(layoutFloors.tenantId, credential.tenantId), eq(layoutFloors.locationId, credential.locationId)));

    if (floorRows.length > 0) {
      await tx.insert(layoutFloors).values(floorRows);
    }

    if (areaRows.length > 0) {
      await tx.insert(layoutAreas).values(areaRows);
    }

    if (tableRows.length > 0) {
      await tx.insert(layoutTables).values(tableRows);
    }
  });

  return getRelayTableLayout(credential.tenantId, credential.locationId);
}

export async function getStaffTableLayout(headers: IncomingHttpHeaders, locationId: string): Promise<TableLayout> {
  const session = await requireStaffSession(headers, locationId);

  return getRelayTableLayout(session.tenant_id, locationId);
}

async function getRelayTableLayout(tenantId: string, locationId: string): Promise<TableLayout> {
  const db = getDrizzleDatabase();
  const tenant = (await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
  const location = (await db
    .select()
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .limit(1))[0];

  if (!tenant || !location) {
    throw new ApiError("Table layout location not found.", 404);
  }

  const floors = await db
    .select()
    .from(layoutFloors)
    .where(and(eq(layoutFloors.tenantId, tenantId), eq(layoutFloors.locationId, locationId)))
    .orderBy(asc(layoutFloors.sortOrder), asc(layoutFloors.name));
  const areas = await db
    .select()
    .from(layoutAreas)
    .where(and(eq(layoutAreas.tenantId, tenantId), eq(layoutAreas.locationId, locationId)))
    .orderBy(asc(layoutAreas.sortOrder), asc(layoutAreas.name));
  const tables = await db
    .select()
    .from(layoutTables)
    .where(and(eq(layoutTables.tenantId, tenantId), eq(layoutTables.locationId, locationId)))
    .orderBy(asc(layoutTables.sortOrder), asc(layoutTables.name));

  return {
    tenant: { id: tenant.id, name: tenant.name },
    location: { id: location.id, tenant_id: location.tenantId, name: location.name },
    floors: await Promise.all(floors.map((floor) => toLayoutFloor(tenantId, locationId, floor, areas, tables)))
  };
}

async function toLayoutFloor(tenantId: string, locationId: string, floor: FloorRow, areas: AreaRow[], tables: TableRow[]) {
  return {
    id: floor.id,
    location_id: floor.locationId,
    name: floor.name,
    sort_order: floor.sortOrder,
    areas: await Promise.all(areas
      .filter((area) => area.floorId === floor.id)
      .map(async (area) => ({
        id: area.id,
        floor_id: area.floorId,
        name: area.name,
        sort_order: area.sortOrder,
        tables: await Promise.all(tables
          .filter((table) => table.areaId === area.id)
          .map(async (table) => {
            const openOrder = await findOpenTableOrder(tenantId, locationId, table.id);

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
          }))
      })))
  };
}

function validateSnapshotForCredential(snapshot: TableLayout, tenantId: string, locationId: string) {
  if (snapshot.tenant.id !== tenantId || snapshot.location.id !== locationId || snapshot.location.tenant_id !== tenantId) {
    throw new ApiError("Table layout snapshot does not belong to this LocalMaster.", 403);
  }
}

function normalizeRequiredText(value: string, message: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new ApiError(message);
  return normalized;
}

function normalizeSortOrder(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ApiError("Sort order must be a positive integer or zero.");
  }

  return value;
}

function normalizePositiveInteger(value: number, message: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new ApiError(message);
  }

  return value;
}
