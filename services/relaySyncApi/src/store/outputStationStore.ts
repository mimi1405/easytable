import { randomUUID } from "node:crypto";

import { and, asc, eq, ne, sql } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import { catalogCategories, catalogOutputStations, catalogProducts, locations, tenants } from "../db/schema.js";
import type {
  CatalogOutputStation,
  CatalogOutputStationCreateRequest,
  CatalogOutputStationUpdateRequest
} from "../types.js";
import { triggerLocalMasterBootstrapRefresh } from "./adminSync.js";
import { ApiError } from "./errors.js";

type CatalogOutputStationRow = typeof catalogOutputStations.$inferSelect;

export async function listOutputStations(tenantId: string, locationId: string): Promise<CatalogOutputStation[]> {
  await requireLocation(tenantId, locationId);

  const rows = await getDrizzleDatabase()
    .select()
    .from(catalogOutputStations)
    .where(and(eq(catalogOutputStations.tenantId, tenantId), eq(catalogOutputStations.locationId, locationId)))
    .orderBy(asc(catalogOutputStations.sortOrder), asc(catalogOutputStations.name));

  return rows.map(toOutputStation);
}

export async function createOutputStation(
  tenantId: string,
  locationId: string,
  request: CatalogOutputStationCreateRequest
): Promise<CatalogOutputStation> {
  await requireLocation(tenantId, locationId);
  const now = new Date();
  const input = normalizeOutputStationInput(request);
  await ensureUniqueStationName(tenantId, locationId, input.name);

  const rows = await getDrizzleDatabase()
    .insert(catalogOutputStations)
    .values({
      id: "station_" + randomUUID(),
      tenantId,
      locationId,
      name: input.name,
      kind: kindFromCapabilities(input.has_kds, input.has_printer),
      hasKds: input.has_kds ? 1 : 0,
      hasPrinter: input.has_printer ? 1 : 0,
      isActive: input.is_active ? 1 : 0,
      sortOrder: input.sort_order,
      createdAt: now,
      updatedAt: now
    })
    .returning();

  triggerLocalMasterBootstrapRefresh(tenantId, locationId);
  return toOutputStation(rows[0]);
}

export async function updateOutputStation(
  tenantId: string,
  locationId: string,
  stationId: string,
  request: CatalogOutputStationUpdateRequest
): Promise<CatalogOutputStation> {
  const current = await requireOutputStation(tenantId, locationId, stationId);
  const input = normalizeOutputStationInput({
    name: request.name ?? current.name,
    has_kds: request.has_kds ?? current.has_kds,
    has_printer: request.has_printer ?? current.has_printer,
    is_active: request.is_active ?? current.is_active,
    sort_order: request.sort_order ?? current.sort_order
  });

  if (input.name !== current.name) {
    await ensureUniqueStationName(tenantId, locationId, input.name, stationId);
  }

  const rows = await getDrizzleDatabase()
    .update(catalogOutputStations)
    .set({
      name: input.name,
      kind: kindFromCapabilities(input.has_kds, input.has_printer),
      hasKds: input.has_kds ? 1 : 0,
      hasPrinter: input.has_printer ? 1 : 0,
      isActive: input.is_active ? 1 : 0,
      sortOrder: input.sort_order,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(catalogOutputStations.tenantId, tenantId),
        eq(catalogOutputStations.locationId, locationId),
        eq(catalogOutputStations.id, stationId)
      )
    )
    .returning();

  triggerLocalMasterBootstrapRefresh(tenantId, locationId);
  return toOutputStation(rows[0]);
}

export async function deleteOutputStation(
  tenantId: string,
  locationId: string,
  stationId: string
): Promise<void> {
  await requireOutputStation(tenantId, locationId, stationId);
  const db = getDrizzleDatabase();

  await db.transaction(async (tx) => {
    // Nullify references in catalog_products
    await tx
      .update(catalogProducts)
      .set({ stationId: null })
      .where(
        and(
          eq(catalogProducts.tenantId, tenantId),
          eq(catalogProducts.locationId, locationId),
          eq(catalogProducts.stationId, stationId)
        )
      );

    // Nullify references in catalog_categories
    await tx
      .update(catalogCategories)
      .set({ defaultStationId: null })
      .where(
        and(
          eq(catalogCategories.tenantId, tenantId),
          eq(catalogCategories.locationId, locationId),
          eq(catalogCategories.defaultStationId, stationId)
        )
      );

    // Delete the station itself
    await tx
      .delete(catalogOutputStations)
      .where(
        and(
          eq(catalogOutputStations.tenantId, tenantId),
          eq(catalogOutputStations.locationId, locationId),
          eq(catalogOutputStations.id, stationId)
        )
      );
  });

  triggerLocalMasterBootstrapRefresh(tenantId, locationId);
}


async function requireTenant(tenantId: string) {
  const rows = await getDrizzleDatabase().select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  if (!rows[0]) {
    throw new ApiError("Tenant not found.", 404);
  }
}

async function requireLocation(tenantId: string, locationId: string) {
  await requireTenant(tenantId);

  const rows = await getDrizzleDatabase()
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .limit(1);

  if (!rows[0]) {
    throw new ApiError("Location not found.", 404);
  }
}

async function requireOutputStation(tenantId: string, locationId: string, stationId: string) {
  await requireLocation(tenantId, locationId);

  const rows = await getDrizzleDatabase()
    .select()
    .from(catalogOutputStations)
    .where(
      and(
        eq(catalogOutputStations.tenantId, tenantId),
        eq(catalogOutputStations.locationId, locationId),
        eq(catalogOutputStations.id, stationId)
      )
    )
    .limit(1);
  const station = rows[0];

  if (!station) {
    throw new ApiError("Output station not found.", 404);
  }

  return toOutputStation(station);
}

async function ensureUniqueStationName(tenantId: string, locationId: string, name: string, exceptStationId?: string) {
  const rows = await getDrizzleDatabase()
    .select({ id: catalogOutputStations.id })
    .from(catalogOutputStations)
    .where(
      and(
        eq(catalogOutputStations.tenantId, tenantId),
        eq(catalogOutputStations.locationId, locationId),
        sql`lower(${catalogOutputStations.name}) = lower(${name})`,
        ne(catalogOutputStations.id, exceptStationId ?? "")
      )
    )
    .limit(1);

  if (rows[0]) {
    throw new ApiError("Output station name already exists for location.", 409);
  }
}

function normalizeOutputStationInput(request: CatalogOutputStationCreateRequest): Required<CatalogOutputStationCreateRequest> {
  return {
    name: normalizeName(request.name, "Output station name is required."),
    has_kds: Boolean(request.has_kds),
    has_printer: Boolean(request.has_printer),
    is_active: request.is_active ?? true,
    sort_order: normalizeSortOrder(request.sort_order ?? 10)
  };
}

function normalizeName(value: string | undefined, message: string) {
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

function kindFromCapabilities(hasKds: boolean, hasPrinter: boolean) {
  if (hasKds && hasPrinter) return "KDS_AND_PRINTER";
  if (hasKds) return "KDS";
  if (hasPrinter) return "PRINTER";
  return "NONE";
}

function toOutputStation(row: CatalogOutputStationRow): CatalogOutputStation {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    location_id: row.locationId,
    name: row.name,
    kind: row.kind,
    has_kds: row.hasKds === 1,
    has_printer: row.hasPrinter === 1,
    is_active: row.isActive === 1,
    sort_order: row.sortOrder,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}
