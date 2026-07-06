import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { and, asc, eq, sql } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import { catalogCategories, catalogOutputStations, catalogProducts, catalogTaxes, relayCommands } from "../db/schema.js";
import { publishCommandEvent } from "../lib/nats.js";
import type {
  CatalogCategory,
  CatalogOutputStation,
  CatalogProduct,
  CatalogTax,
  OwnerCatalogCommandRequest,
  OwnerCatalogSnapshot,
  StaffRelayCommandResponse,
  TenantUserRole
} from "../types.js";
import { ApiError } from "./errors.js";
import { requireLocalMasterCredential } from "./provisioningStore.js";
import { requireRelayLocation, requireStaffSession, type StaffSession } from "./staffRelayStore.js";

type RelayCommandRow = typeof relayCommands.$inferSelect;

const ownerCatalogActions = new Set([
  "OWNER_CATALOG_PRODUCT_CREATE",
  "OWNER_CATALOG_PRODUCT_UPDATE",
  "OWNER_CATALOG_PRODUCT_DELETE",
  "OWNER_CATALOG_PRODUCT_DUPLICATE",
  "OWNER_CATALOG_CATEGORY_CREATE",
  "OWNER_CATALOG_CATEGORY_UPDATE",
  "OWNER_CATALOG_CATEGORY_DELETE",
  "OWNER_CATALOG_CATEGORY_DUPLICATE",
  "OWNER_CATALOG_TAX_CREATE",
  "OWNER_CATALOG_TAX_UPDATE",
  "OWNER_CATALOG_TAX_DELETE",
  "OWNER_CATALOG_TAX_DUPLICATE"
]);

export async function replaceLocalMasterCatalog(relayToken: string, snapshot: OwnerCatalogSnapshot): Promise<OwnerCatalogSnapshot> {
  const credential = await requireLocalMasterCredential(relayToken);
  const now = new Date();

  await getDrizzleDatabase().transaction(async (tx) => {
    await tx.delete(catalogProducts).where(and(eq(catalogProducts.tenantId, credential.tenantId), eq(catalogProducts.locationId, credential.locationId)));
    await tx.delete(catalogCategories).where(and(eq(catalogCategories.tenantId, credential.tenantId), eq(catalogCategories.locationId, credential.locationId)));
    await tx.delete(catalogTaxes).where(and(eq(catalogTaxes.tenantId, credential.tenantId), eq(catalogTaxes.locationId, credential.locationId)));
    await tx.delete(catalogOutputStations).where(and(eq(catalogOutputStations.tenantId, credential.tenantId), eq(catalogOutputStations.locationId, credential.locationId)));

    const stations = snapshot.output_stations.map((station) => ({
      id: required(station.id, "Station id is required."),
      tenantId: credential.tenantId,
      locationId: credential.locationId,
      name: required(station.name, "Station name is required."),
      kind: station.kind || "NONE",
      hasKds: station.has_kds ? 1 : 0,
      hasPrinter: station.has_printer ? 1 : 0,
      isActive: station.is_active ? 1 : 0,
      sortOrder: integer(station.sort_order, "Station sort order is invalid."),
      createdAt: now,
      updatedAt: now
    }));
    const categories = snapshot.categories.map((category) => ({
      id: required(category.id, "Category id is required."),
      tenantId: credential.tenantId,
      locationId: credential.locationId,
      name: required(category.name, "Category name is required."),
      sortOrder: integer(category.sort_order, "Category sort order is invalid."),
      defaultStationId: category.default_station_id ?? null,
      createdAt: now,
      updatedAt: now
    }));
    const taxes = snapshot.taxes.map((tax) => ({
      id: required(tax.id, "Tax id is required."),
      tenantId: credential.tenantId,
      locationId: credential.locationId,
      name: required(tax.name, "Tax name is required."),
      rateBps: integer(tax.rate_bps, "Tax rate is invalid."),
      sortOrder: integer(tax.sort_order, "Tax sort order is invalid."),
      createdAt: now,
      updatedAt: now
    }));
    const products = snapshot.products.map((product) => ({
      id: required(product.id, "Product id is required."),
      tenantId: credential.tenantId,
      locationId: credential.locationId,
      categoryId: required(product.category_id, "Product category is required."),
      taxId: product.tax_id ?? product.tax_code_id,
      productType: product.product_type,
      name: required(product.name, "Product name is required."),
      price: integer(product.price, "Product price is invalid."),
      taxCodeId: required(product.tax_code_id, "Product tax code is required."),
      taxCodeName: required(product.tax_code_name, "Product tax name is required."),
      taxRateBps: integer(product.tax_rate_bps, "Product tax rate is invalid."),
      isAvailable: product.is_available ? 1 : 0,
      stationId: product.station_id ?? null,
      createdAt: now,
      updatedAt: now
    }));

    if (stations.length) await tx.insert(catalogOutputStations).values(stations);
    if (categories.length) await tx.insert(catalogCategories).values(categories);
    if (taxes.length) await tx.insert(catalogTaxes).values(taxes);
    if (products.length) await tx.insert(catalogProducts).values(products);
  });

  return getCatalogSnapshot(credential.tenantId, credential.locationId);
}

export async function getStaffProducts(headers: IncomingHttpHeaders, locationId: string): Promise<CatalogProduct[]> {
  const session = await requireStaffSession(headers, locationId);
  requireSessionLocation(session, locationId);
  return (await getCatalogSnapshot(session.tenant_id, locationId)).products.filter((product) => product.is_available);
}

export async function getStaffOutputStations(headers: IncomingHttpHeaders, locationId: string): Promise<CatalogOutputStation[]> {
  const session = await requireStaffSession(headers, locationId);
  requireSessionLocation(session, locationId);
  return (await getCatalogSnapshot(session.tenant_id, locationId)).output_stations.filter((station) => station.is_active);
}

export async function getStaffProductVariantGroups(headers: IncomingHttpHeaders, locationId: string, _productId: string) {
  const session = await requireStaffSession(headers, locationId);
  requireSessionLocation(session, locationId);
  return [];
}

export async function getOwnerCatalog(headers: IncomingHttpHeaders, locationId: string): Promise<OwnerCatalogSnapshot> {
  const session = await requireStaffSession(headers, locationId);
  requireOwnerRole(session.role);
  requireSessionLocation(session, locationId);
  return getCatalogSnapshot(session.tenant_id, locationId);
}

export async function createOwnerCatalogCommand(
  headers: IncomingHttpHeaders,
  locationId: string,
  request: OwnerCatalogCommandRequest
): Promise<StaffRelayCommandResponse> {
  const session = await requireStaffSession(headers, locationId);
  requireOwnerRole(session.role);
  requireSessionLocation(session, locationId);
  const location = await requireRelayLocation(session.tenant_id, locationId);
  const requestId = required(request.request_id, "request_id is required.");
  const action = required(request.action, "action is required.");

  if (!ownerCatalogActions.has(action)) {
    throw new ApiError("Owner catalog action is not supported.", 400);
  }

  const commandId = "owner_catalog_" + createHash("sha256").update(session.tenant_id + ":" + locationId + ":" + requestId).digest("hex");
  const payload = {
    request_id: requestId,
    action,
    payload: request.payload ?? null,
    submitted_by: {
      user_id: session.user_id,
      display_name: session.display_name,
      role: session.role
    }
  };
  const existing = (await getDrizzleDatabase()
    .select()
    .from(relayCommands)
    .where(and(eq(relayCommands.id, commandId), eq(relayCommands.tenantId, session.tenant_id), eq(relayCommands.locationId, locationId)))
    .limit(1))[0];

  if (existing) {
    if (fingerprint(existing.payloadJson) !== fingerprint(payload)) {
      throw new ApiError("request_id was already used with a different payload.", 409);
    }
    return toRelayCommandResponse(existing);
  }

  const rows = await getDrizzleDatabase()
    .insert(relayCommands)
    .values({
      id: commandId,
      tenantId: session.tenant_id,
      locationId,
      localMasterInstanceId: location.localMasterInstanceId,
      type: action,
      status: "pending",
      payloadJson: payload,
      resultJson: null,
      deliveredAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .returning();

  if (rows[0] && location.localMasterInstanceId) {
    void publishCommandEvent(session.tenant_id, locationId, location.localMasterInstanceId, commandId);
  }

  return toRelayCommandResponse(rows[0]);
}

async function getCatalogSnapshot(tenantId: string, locationId: string): Promise<OwnerCatalogSnapshot> {
  const db = getDrizzleDatabase();
  const stations = await db
    .select()
    .from(catalogOutputStations)
    .where(and(eq(catalogOutputStations.tenantId, tenantId), eq(catalogOutputStations.locationId, locationId)))
    .orderBy(asc(catalogOutputStations.sortOrder), asc(catalogOutputStations.name));
  const categories = await db
    .select({
      id: catalogCategories.id,
      name: catalogCategories.name,
      sortOrder: catalogCategories.sortOrder,
      defaultStationId: catalogCategories.defaultStationId,
      defaultStationName: catalogOutputStations.name,
      productCount: sql<number>`count(${catalogProducts.id})`,
      createdAt: catalogCategories.createdAt,
      updatedAt: catalogCategories.updatedAt
    })
    .from(catalogCategories)
    .leftJoin(catalogProducts, and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.locationId, locationId), eq(catalogProducts.categoryId, catalogCategories.id)))
    .leftJoin(catalogOutputStations, and(eq(catalogOutputStations.tenantId, tenantId), eq(catalogOutputStations.locationId, locationId), eq(catalogOutputStations.id, catalogCategories.defaultStationId)))
    .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.locationId, locationId)))
    .groupBy(catalogCategories.id, catalogOutputStations.name)
    .orderBy(asc(catalogCategories.sortOrder), asc(catalogCategories.name));
  const taxes = await db
    .select({
      id: catalogTaxes.id,
      name: catalogTaxes.name,
      rateBps: catalogTaxes.rateBps,
      sortOrder: catalogTaxes.sortOrder,
      productCount: sql<number>`count(${catalogProducts.id})`,
      createdAt: catalogTaxes.createdAt,
      updatedAt: catalogTaxes.updatedAt
    })
    .from(catalogTaxes)
    .leftJoin(catalogProducts, and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.locationId, locationId), eq(catalogProducts.taxId, catalogTaxes.id)))
    .where(and(eq(catalogTaxes.tenantId, tenantId), eq(catalogTaxes.locationId, locationId)))
    .groupBy(catalogTaxes.id)
    .orderBy(asc(catalogTaxes.sortOrder), asc(catalogTaxes.name));
  const products = await db
    .select({
      id: catalogProducts.id,
      categoryId: catalogProducts.categoryId,
      category: catalogCategories.name,
      taxId: catalogProducts.taxId,
      productType: catalogProducts.productType,
      name: catalogProducts.name,
      price: catalogProducts.price,
      taxCodeId: catalogProducts.taxCodeId,
      taxCodeName: catalogProducts.taxCodeName,
      taxRateBps: catalogProducts.taxRateBps,
      isAvailable: catalogProducts.isAvailable,
      stationId: catalogProducts.stationId,
      stationName: catalogOutputStations.name,
      createdAt: catalogProducts.createdAt,
      updatedAt: catalogProducts.updatedAt
    })
    .from(catalogProducts)
    .innerJoin(catalogCategories, and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.locationId, locationId), eq(catalogCategories.id, catalogProducts.categoryId)))
    .leftJoin(catalogOutputStations, and(eq(catalogOutputStations.tenantId, tenantId), eq(catalogOutputStations.locationId, locationId), eq(catalogOutputStations.id, catalogProducts.stationId)))
    .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.locationId, locationId)))
    .orderBy(asc(catalogCategories.sortOrder), asc(catalogCategories.name), asc(catalogProducts.name));

  return {
    products: products.map((product) => ({
      id: product.id,
      category_id: product.categoryId,
      tax_id: product.taxId ?? product.taxCodeId,
      product_type: product.productType as "BASIC" | "SERVICE",
      name: product.name,
      category: product.category,
      price: product.price,
      tax_code_id: product.taxCodeId,
      tax_code_name: product.taxCodeName,
      tax_rate_bps: product.taxRateBps,
      is_available: product.isAvailable === 1,
      isAvailable: product.isAvailable === 1,
      station_id: product.stationId,
      station_name: product.stationName,
      station: product.stationName ?? "",
      created_at: product.createdAt.getTime(),
      updated_at: product.updatedAt.getTime()
    })),
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      sort_order: category.sortOrder,
      default_station_id: category.defaultStationId,
      default_station_name: category.defaultStationName,
      product_count: Number(category.productCount ?? 0),
      created_at: category.createdAt.getTime(),
      updated_at: category.updatedAt.getTime()
    })),
    taxes: taxes.map((tax) => ({
      id: tax.id,
      name: tax.name,
      rate_bps: tax.rateBps,
      sort_order: tax.sortOrder,
      product_count: Number(tax.productCount ?? 0),
      created_at: tax.createdAt.getTime(),
      updated_at: tax.updatedAt.getTime()
    })),
    output_stations: stations.map((station): CatalogOutputStation => ({
      id: station.id,
      tenant_id: station.tenantId,
      location_id: station.locationId,
      name: station.name,
      kind: station.kind,
      has_kds: station.hasKds === 1,
      has_printer: station.hasPrinter === 1,
      is_active: station.isActive === 1,
      sort_order: station.sortOrder,
      created_at: station.createdAt.toISOString(),
      updated_at: station.updatedAt.toISOString()
    }))
  };
}

function requireSessionLocation(session: StaffSession, locationId: string) {
  if (session.location_id !== locationId) {
    throw new ApiError("Session does not belong to this location.", 403);
  }
}

function requireOwnerRole(role: TenantUserRole) {
  if (role !== "OWNER" && role !== "MANAGER") {
    throw new ApiError("Owner or manager role is required.", 403);
  }
}

function toRelayCommandResponse(row: RelayCommandRow): StaffRelayCommandResponse {
  return {
    command_id: row.id,
    tenant_id: row.tenantId,
    location_id: row.locationId,
    local_master_instance_id: row.localMasterInstanceId,
    type: row.type,
    status: row.status,
    payload: row.payloadJson,
    result: row.resultJson ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    poll_url: "/api/staff/commands/" + encodeURIComponent(row.id)
  };
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

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "__undefined";
  if (Array.isArray(value)) return "[" + value.map((item) => stableStringify(item)).join(",") + "]";
  return "{" + Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => JSON.stringify(key) + ":" + stableStringify(item))
    .join(",") + "}";
}
