import { randomUUID } from "node:crypto";

import { and, asc, eq, ne, sql } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import { locations, tenants } from "../db/schema.js";
import type { Location, LocationCreateRequest, LocationServiceMode, LocationStatus, LocationUpdateRequest } from "../types.js";
import { ApiError } from "./errors.js";

type LocationRow = typeof locations.$inferSelect;

export async function listLocations(tenantId: string): Promise<Location[]> {
  await requireTenant(tenantId);

  const rows = await getDrizzleDatabase()
    .select()
    .from(locations)
    .where(eq(locations.tenantId, tenantId))
    .orderBy(asc(locations.name));

  return rows.map(toLocation);
}

export async function createLocation(tenantId: string, request: LocationCreateRequest): Promise<Location> {
  await requireTenant(tenantId);
  const now = new Date();
  const input = normalizeLocationInput(request);
  await ensureUniqueLocationSlug(tenantId, input.slug);

  const rows = await getDrizzleDatabase()
    .insert(locations)
    .values({
      id: "loc_" + randomUUID(),
      tenantId,
      name: input.name,
      slug: input.slug,
      address: input.address,
      localMasterInstanceId: input.local_master_instance_id,
      serviceMode: input.service_mode,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return toLocation(rows[0]);
}

export async function updateLocation(tenantId: string, locationId: string, request: LocationUpdateRequest): Promise<Location> {
  const current = await requireLocation(tenantId, locationId);
  const input = normalizeLocationInput({
    name: request.name ?? current.name,
    slug: request.slug ?? current.slug,
    address: request.address === undefined ? current.address : request.address,
    local_master_instance_id: request.local_master_instance_id === undefined ? current.local_master_instance_id : request.local_master_instance_id,
    service_mode: request.service_mode ?? current.service_mode,
    status: request.status ?? current.status,
  });

  if (input.slug !== current.slug) {
    await ensureUniqueLocationSlug(tenantId, input.slug, locationId);
  }

  const rows = await getDrizzleDatabase()
    .update(locations)
    .set({
      name: input.name,
      slug: input.slug,
      address: input.address,
      localMasterInstanceId: input.local_master_instance_id,
      serviceMode: input.service_mode,
      status: input.status,
      updatedAt: new Date(),
    })
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .returning();

  return toLocation(rows[0]);
}

async function requireTenant(tenantId: string) {
  const rows = await getDrizzleDatabase().select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);

  if (!rows[0]) {
    throw new ApiError("Tenant not found.", 404);
  }
}

async function requireLocation(tenantId: string, locationId: string) {
  const rows = await getDrizzleDatabase()
    .select()
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .limit(1);
  const location = rows[0];

  if (!location) {
    throw new ApiError("Location not found.", 404);
  }

  return toLocation(location);
}

async function ensureUniqueLocationSlug(tenantId: string, slug: string, exceptLocationId?: string) {
  const rows = await getDrizzleDatabase()
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), sql`lower(${locations.slug}) = lower(${slug})`, ne(locations.id, exceptLocationId ?? "")))
    .limit(1);

  if (rows[0]) {
    throw new ApiError("Location slug already exists for tenant.", 409);
  }
}

function normalizeLocationInput(request: LocationCreateRequest): Required<LocationCreateRequest> {
  return {
    name: normalizeName(request.name, "Location name is required."),
    slug: normalizeSlug(request.slug),
    address: normalizeOptionalText(request.address),
    local_master_instance_id: normalizeOptionalText(request.local_master_instance_id),
    service_mode: normalizeServiceMode(request.service_mode ?? "TABLE_SERVICE"),
    status: normalizeStatus(request.status ?? "ACTIVE"),
  };
}

function normalizeName(value: string | undefined, message: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new ApiError(message);
  return normalized;
}

function normalizeSlug(value: string | undefined) {
  const slug = value?.trim().toLowerCase() ?? "";

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ApiError("Location slug must use lowercase letters, numbers, and hyphens.");
  }

  return slug;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeStatus(value: string): LocationStatus {
  if (value !== "ACTIVE" && value !== "SUSPENDED") {
    throw new ApiError("Location status must be ACTIVE or SUSPENDED.");
  }

  return value;
}

function normalizeServiceMode(value: string): LocationServiceMode {
  if (value !== "TABLE_SERVICE" && value !== "COUNTER_SERVICE") {
    throw new ApiError("Location service mode must be TABLE_SERVICE or COUNTER_SERVICE.");
  }

  return value;
}

function toLocation(row: LocationRow): Location {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    name: row.name,
    slug: row.slug,
    address: row.address,
    local_master_instance_id: row.localMasterInstanceId,
    service_mode: row.serviceMode as LocationServiceMode,
    status: row.status as LocationStatus,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
