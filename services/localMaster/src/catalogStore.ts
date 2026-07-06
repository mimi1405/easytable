import { randomUUID } from "node:crypto";

import { and, asc, count, eq, ne, sql } from "drizzle-orm";

import { getDrizzleDatabase } from "./db/client.js";
import { catalogCategories, catalogOutputStations, catalogProducts, catalogTaxes } from "./db/schema.js";
import { loadLocalSiteConfig } from "./store/localSiteStore.js";
import type {
  CatalogCategory,
  CatalogCategoryCreateRequest,
  CatalogCategoryUpdateRequest,
  CatalogOutputStation,
  CatalogOutputStationKind,
  CatalogProduct,
  CatalogProductCreateRequest,
  CatalogProductUpdateRequest,
  CatalogTax,
  CatalogTaxCreateRequest,
  CatalogTaxUpdateRequest,
  PosProduct
} from "./types.js";

const tenantId = "tenant_basilica";

const defaultOutputStations: CatalogOutputStation[] = [
  createSeedStation("station_shisha", "Shisha", "KDS_AND_PRINTER", 10),
  createSeedStation("station_bar", "Bar", "KDS_AND_PRINTER", 20),
  createSeedStation("station_snack", "Snack", "KDS_AND_PRINTER", 30)
];

const defaultProducts: PosProduct[] = [
  createSeedProduct("prod_invoice", "SERVICE", "Rechnung", "Service", 0, "tax_standard_ch", "MwSt 8.1%", 810, null),
  createSeedProduct("prod_service_personal", "SERVICE", "Service Personal", "Service", 0, "tax_standard_ch", "MwSt 8.1%", 810, null),
  createSeedProduct("prod_shisha_standard", "BASIC", "Shisha Standard", "Shisha", 3000, "tax_standard_ch", "MwSt 8.1%", 810, "station_shisha"),
  createSeedProduct("prod_nava_shisha", "BASIC", "NAVA Shisha", "Shisha", 5900, "tax_standard_ch", "MwSt 8.1%", 810, "station_shisha"),
  createSeedProduct("prod_smokezilla_laser_shisha", "BASIC", "SmokeZilla Laser Shisha", "Shisha", 8900, "tax_standard_ch", "MwSt 8.1%", 810, "station_shisha"),
  createSeedProduct("prod_shisha_triple_skull", "BASIC", "Shisha Triple Skull", "Shisha", 4500, "tax_standard_ch", "MwSt 8.1%", 810, "station_shisha"),
  createSeedProduct("prod_neuer_kopf", "SERVICE", "Neuer Kopf", "Shisha", 1500, "tax_standard_ch", "MwSt 8.1%", 810, "station_shisha"),
  createSeedProduct("prod_kohle", "SERVICE", "Kohle", "Shisha", 0, "tax_standard_ch", "MwSt 8.1%", 810, "station_shisha"),
  createSeedProduct("prod_mundstucke", "SERVICE", "Mundstucke", "Shisha", 300, "tax_standard_ch", "MwSt 8.1%", 810, "station_shisha"),
  createSeedProduct("prod_chinotto", "BASIC", "Chinotto", "Sussgetranke", 700, "tax_standard_ch", "MwSt 8.1%", 810, "station_bar")
];

type CatalogProductRow = {
  id: string;
  productType: string;
  name: string;
  categoryId: string;
  category: string;
  taxId: string | null;
  price: number;
  taxCodeId: string;
  taxCodeName: string;
  taxRateBps: number;
  isAvailable: number;
  stationId: string | null;
  stationName: string | null;
  createdAt: number;
  updatedAt: number;
};

type CatalogCategoryRow = {
  id: string;
  name: string;
  sortOrder: number;
  defaultStationId: string | null;
  defaultStationName: string | null;
  productCount: number;
  createdAt: number;
  updatedAt: number;
};

type CatalogOutputStationRow = {
  id: string;
  tenantId: string;
  name: string;
  kind: string;
  hasKds: number;
  hasPrinter: number;
  isActive: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

type CatalogTaxRow = {
  id: string;
  name: string;
  rateBps: number;
  sortOrder: number;
  productCount: number;
  createdAt: number;
  updatedAt: number;
};

export class CatalogError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function listProducts(): CatalogProduct[] {
  ensureCatalogSeeded();

  return getDrizzleDatabase()
    .select(productSelectFields)
    .from(catalogProducts)
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogProducts.categoryId))
    .leftJoin(catalogOutputStations, eq(catalogOutputStations.id, catalogProducts.stationId))
    .orderBy(asc(catalogCategories.sortOrder), asc(catalogCategories.name), asc(catalogProducts.name))
    .all()
    .map(toCatalogProduct);
}

export function getProductById(productId: string): CatalogProduct | null {
  ensureCatalogSeeded();

  const row = getDrizzleDatabase()
    .select(productSelectFields)
    .from(catalogProducts)
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogProducts.categoryId))
    .leftJoin(catalogOutputStations, eq(catalogOutputStations.id, catalogProducts.stationId))
    .where(eq(catalogProducts.id, productId))
    .get();

  return row ? toCatalogProduct(row) : null;
}

export function listCatalogCategories(): CatalogCategory[] {
  ensureCatalogSeeded();

  return getDrizzleDatabase()
    .select(categorySelectFields)
    .from(catalogCategories)
    .leftJoin(catalogProducts, eq(catalogProducts.categoryId, catalogCategories.id))
    .leftJoin(catalogOutputStations, eq(catalogOutputStations.id, catalogCategories.defaultStationId))
    .groupBy(catalogCategories.id)
    .orderBy(asc(catalogCategories.sortOrder), asc(catalogCategories.name))
    .all()
    .map(toCatalogCategory);
}

export function listCatalogTaxes(): CatalogTax[] {
  ensureCatalogSeeded();

  return getDrizzleDatabase()
    .select(taxSelectFields)
    .from(catalogTaxes)
    .leftJoin(catalogProducts, eq(catalogProducts.taxId, catalogTaxes.id))
    .groupBy(catalogTaxes.id)
    .orderBy(asc(catalogTaxes.sortOrder), asc(catalogTaxes.name))
    .all()
    .map(toCatalogTax);
}

export function listCatalogOutputStations(): CatalogOutputStation[] {
  ensureCatalogSeeded();
  const currentTenantId = loadLocalSiteConfig().tenant.id;

  return getDrizzleDatabase()
    .select()
    .from(catalogOutputStations)
    .where(and(eq(catalogOutputStations.tenantId, currentTenantId), eq(catalogOutputStations.isActive, 1)))
    .orderBy(asc(catalogOutputStations.sortOrder), asc(catalogOutputStations.name))
    .all()
    .map(toCatalogOutputStation);
}

export function applyBootstrapOutputStations(stations: CatalogOutputStation[]) {
  const db = getDrizzleDatabase();
  const now = Date.now();
  const bootstrapStationIds = new Set(stations.map((s) => s.id));

  db.transaction((tx) => {
    // Upsert all stations from the bootstrap payload
    for (const station of stations) {
      const kind = normalizeStationKind(station);
      tx.insert(catalogOutputStations)
        .values({
          id: station.id,
          tenantId: station.tenant_id,
          name: station.name,
          kind,
          hasKds: station.has_kds ? 1 : 0,
          hasPrinter: station.has_printer ? 1 : 0,
          isActive: station.is_active ? 1 : 0,
          sortOrder: station.sort_order,
          createdAt: toTimestamp(station.created_at, now),
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: catalogOutputStations.id,
          set: {
            tenantId: station.tenant_id,
            name: station.name,
            kind,
            hasKds: station.has_kds ? 1 : 0,
            hasPrinter: station.has_printer ? 1 : 0,
            isActive: station.is_active ? 1 : 0,
            sortOrder: station.sort_order,
            updatedAt: now
          }
        })
        .run();
    }

    // Deactivate stations that are no longer present in the bootstrap
    const allLocalStations = tx
      .select({ id: catalogOutputStations.id })
      .from(catalogOutputStations)
      .all();

    const removedStationIds = allLocalStations
      .map((s) => s.id)
      .filter((id) => !bootstrapStationIds.has(id));

    for (const removedId of removedStationIds) {
      // Nullify references in catalog_products
      tx.update(catalogProducts)
        .set({ stationId: null, updatedAt: now })
        .where(eq(catalogProducts.stationId, removedId))
        .run();

      // Nullify references in catalog_categories
      tx.update(catalogCategories)
        .set({ defaultStationId: null, updatedAt: now })
        .where(eq(catalogCategories.defaultStationId, removedId))
        .run();

      // Deactivate the station
      tx.update(catalogOutputStations)
        .set({ isActive: 0, updatedAt: now })
        .where(eq(catalogOutputStations.id, removedId))
        .run();
    }
  });
}

export function createCatalogProduct(request: CatalogProductCreateRequest): CatalogProduct {
  ensureCatalogSeeded();

  const now = Date.now();
  const input = normalizeProductInput(withCategoryDefaultStation(request));
  const tax = requireTax(input.tax_id);
  const station = input.station_id ? requireOutputStation(input.station_id) : null;
  const id = "prod_" + randomUUID();

  getDrizzleDatabase()
    .insert(catalogProducts)
    .values({
      id,
      categoryId: input.category_id,
      taxId: tax.id,
      productType: input.product_type,
      name: input.name,
      price: input.price,
      taxCodeId: tax.id,
      taxCodeName: tax.name,
      taxRateBps: tax.rate_bps,
      isAvailable: input.is_available ? 1 : 0,
      stationId: station?.id ?? null,
      createdAt: now,
      updatedAt: now
    })
    .run();

  return requireProduct(id);
}

export function updateCatalogProduct(productId: string, request: CatalogProductUpdateRequest): CatalogProduct {
  ensureCatalogSeeded();

  const current = requireProduct(productId);
  const input = normalizeProductInput({
    category_id: request.category_id ?? current.category_id,
    tax_id: request.tax_id ?? current.tax_id,
    product_type: request.product_type ?? current.product_type,
    name: request.name ?? current.name,
    price: request.price ?? current.price,
    is_available: request.is_available ?? current.is_available,
    station_id: request.station_id === undefined ? current.station_id : request.station_id
  });
  const tax = requireTax(input.tax_id);
  const station = input.station_id ? requireOutputStation(input.station_id) : null;

  getDrizzleDatabase()
    .update(catalogProducts)
    .set({
      categoryId: input.category_id,
      taxId: tax.id,
      productType: input.product_type,
      name: input.name,
      price: input.price,
      taxCodeId: tax.id,
      taxCodeName: tax.name,
      taxRateBps: tax.rate_bps,
      isAvailable: input.is_available ? 1 : 0,
      stationId: station?.id ?? null,
      updatedAt: Date.now()
    })
    .where(eq(catalogProducts.id, productId))
    .run();

  return requireProduct(productId);
}

export function duplicateCatalogProduct(productId: string): CatalogProduct {
  const current = requireProduct(productId);

  return createCatalogProduct({
    category_id: current.category_id,
    tax_id: current.tax_id,
    product_type: current.product_type,
    name: uniqueProductName(current.name + " Kopie"),
    price: current.price,
    is_available: current.is_available,
    station_id: current.station_id
  });
}

export function deleteCatalogProduct(productId: string) {
  ensureCatalogSeeded();
  requireProduct(productId);

  getDrizzleDatabase().delete(catalogProducts).where(eq(catalogProducts.id, productId)).run();
}

export function createCatalogCategory(request: CatalogCategoryCreateRequest): CatalogCategory {
  ensureCatalogSeeded();

  const now = Date.now();
  const name = normalizeName(request.name, "Category name is required.");
  ensureUniqueCategoryName(name);
  const sortOrder = normalizeOptionalInteger(request.sort_order, nextCategorySortOrder());
  const defaultStationId = normalizeOptionalStationId(request.default_station_id);
  const defaultStation = defaultStationId ? requireOutputStation(defaultStationId) : null;
  const id = "cat_" + randomUUID();

  getDrizzleDatabase()
    .insert(catalogCategories)
    .values({ id, name, sortOrder, defaultStationId: defaultStation?.id ?? null, createdAt: now, updatedAt: now })
    .run();

  return requireCategory(id);
}

export function updateCatalogCategory(categoryId: string, request: CatalogCategoryUpdateRequest): CatalogCategory {
  ensureCatalogSeeded();
  const current = requireCategory(categoryId);
  const name = request.name === undefined ? current.name : normalizeName(request.name, "Category name is required.");
  const sortOrder = request.sort_order === undefined ? current.sort_order : normalizeOptionalInteger(request.sort_order, current.sort_order);
  const defaultStationId = request.default_station_id === undefined
    ? current.default_station_id
    : normalizeOptionalStationId(request.default_station_id);
  const defaultStation = defaultStationId ? requireOutputStation(defaultStationId) : null;
  const normalizedDefaultStationId = defaultStation?.id ?? null;
  const defaultStationChanged = request.default_station_id !== undefined && normalizedDefaultStationId !== current.default_station_id;

  if (name !== current.name) {
    ensureUniqueCategoryName(name, categoryId);
  }

  const now = Date.now();

  getDrizzleDatabase().transaction((tx) => {
    tx.update(catalogCategories)
      .set({ name, sortOrder, defaultStationId: normalizedDefaultStationId, updatedAt: now })
      .where(eq(catalogCategories.id, categoryId))
      .run();

    if (defaultStationChanged) {
      tx.update(catalogProducts)
        .set({ stationId: normalizedDefaultStationId, updatedAt: now })
        .where(eq(catalogProducts.categoryId, categoryId))
        .run();
    }
  });

  return requireCategory(categoryId);
}

export function duplicateCatalogCategory(categoryId: string): CatalogCategory {
  const current = requireCategory(categoryId);

  return createCatalogCategory({
    name: uniqueCategoryName(current.name + " Kopie"),
    sort_order: current.sort_order + 1,
    default_station_id: current.default_station_id
  });
}

export function deleteCatalogCategory(categoryId: string) {
  ensureCatalogSeeded();
  requireCategory(categoryId);

  const row = getDrizzleDatabase()
    .select({ count: count() })
    .from(catalogProducts)
    .where(eq(catalogProducts.categoryId, categoryId))
    .get();

  if ((row?.count ?? 0) > 0) {
    throw new CatalogError("Category still has products assigned.", 409);
  }

  getDrizzleDatabase().delete(catalogCategories).where(eq(catalogCategories.id, categoryId)).run();
}

export function createCatalogTax(request: CatalogTaxCreateRequest): CatalogTax {
  ensureCatalogSeeded();

  const now = Date.now();
  const id = normalizeTaxId(request.id, request.name);
  const name = normalizeName(request.name, "Tax name is required.");
  const rateBps = normalizeInteger(request.rate_bps, "Tax rate must be a positive integer or zero.");
  const sortOrder = normalizeOptionalInteger(request.sort_order, nextTaxSortOrder());
  ensureUniqueTaxId(id);

  getDrizzleDatabase()
    .insert(catalogTaxes)
    .values({ id, name, rateBps, sortOrder, createdAt: now, updatedAt: now })
    .run();

  return requireTax(id);
}

export function updateCatalogTax(taxId: string, request: CatalogTaxUpdateRequest): CatalogTax {
  ensureCatalogSeeded();
  const current = requireTax(taxId);
  const name = request.name === undefined ? current.name : normalizeName(request.name, "Tax name is required.");
  const rateBps = request.rate_bps === undefined ? current.rate_bps : normalizeInteger(request.rate_bps, "Tax rate must be a positive integer or zero.");
  const sortOrder = request.sort_order === undefined ? current.sort_order : normalizeOptionalInteger(request.sort_order, current.sort_order);
  const now = Date.now();
  const db = getDrizzleDatabase();

  db.update(catalogTaxes)
    .set({ name, rateBps, sortOrder, updatedAt: now })
    .where(eq(catalogTaxes.id, taxId))
    .run();
  db.update(catalogProducts)
    .set({ taxCodeName: name, taxRateBps: rateBps, updatedAt: now })
    .where(eq(catalogProducts.taxId, taxId))
    .run();

  return requireTax(taxId);
}

export function duplicateCatalogTax(taxId: string): CatalogTax {
  const current = requireTax(taxId);

  return createCatalogTax({ name: uniqueTaxName(current.name + " Kopie"), rate_bps: current.rate_bps, sort_order: current.sort_order + 1 });
}

export function deleteCatalogTax(taxId: string) {
  ensureCatalogSeeded();
  requireTax(taxId);

  const row = getDrizzleDatabase()
    .select({ count: count() })
    .from(catalogProducts)
    .where(eq(catalogProducts.taxId, taxId))
    .get();

  if ((row?.count ?? 0) > 0) {
    throw new CatalogError("Tax is still assigned to products.", 409);
  }

  getDrizzleDatabase().delete(catalogTaxes).where(eq(catalogTaxes.id, taxId)).run();
}

const productSelectFields = {
  id: catalogProducts.id,
  productType: catalogProducts.productType,
  name: catalogProducts.name,
  categoryId: catalogProducts.categoryId,
  category: catalogCategories.name,
  taxId: catalogProducts.taxId,
  price: catalogProducts.price,
  taxCodeId: catalogProducts.taxCodeId,
  taxCodeName: catalogProducts.taxCodeName,
  taxRateBps: catalogProducts.taxRateBps,
  isAvailable: catalogProducts.isAvailable,
  stationId: catalogProducts.stationId,
  stationName: catalogOutputStations.name,
  createdAt: catalogProducts.createdAt,
  updatedAt: catalogProducts.updatedAt
};

const categorySelectFields = {
  id: catalogCategories.id,
  name: catalogCategories.name,
  sortOrder: catalogCategories.sortOrder,
  defaultStationId: catalogCategories.defaultStationId,
  defaultStationName: catalogOutputStations.name,
  createdAt: catalogCategories.createdAt,
  updatedAt: catalogCategories.updatedAt,
  productCount: count(catalogProducts.id)
};

const taxSelectFields = {
  id: catalogTaxes.id,
  name: catalogTaxes.name,
  rateBps: catalogTaxes.rateBps,
  sortOrder: catalogTaxes.sortOrder,
  createdAt: catalogTaxes.createdAt,
  updatedAt: catalogTaxes.updatedAt,
  productCount: count(catalogProducts.id)
};

function ensureCatalogSeeded() {
  // Runtime seeding completely disabled
}

function seedCategoriesAndProducts() {
  const db = getDrizzleDatabase();
  const now = Date.now();
  const categories = Array.from(new Set(defaultProducts.map((product) => product.category)));
  const categoryIdsByName = new Map<string, string>();

  db.transaction((tx) => {
    categories.forEach((name, index) => {
      const id = "cat_" + slugify(name);
      const defaultStationId = defaultStationForCategory(name);
      categoryIdsByName.set(name, id);
      tx.insert(catalogCategories)
        .values({ id, name, sortOrder: (index + 1) * 10, defaultStationId, createdAt: now, updatedAt: now })
        .run();
    });

    for (const product of defaultProducts) {
      tx.insert(catalogProducts)
        .values({
          id: product.id,
          categoryId: categoryIdsByName.get(product.category) ?? "",
          taxId: product.tax_code_id,
          productType: product.product_type,
          name: product.name,
          price: product.price,
          taxCodeId: product.tax_code_id,
          taxCodeName: product.tax_code_name,
          taxRateBps: product.tax_rate_bps,
          isAvailable: product.is_available ? 1 : 0,
          stationId: product.station_id,
          createdAt: now,
          updatedAt: now
        })
        .run();
    }
  });
}

function ensureOutputStationsSeeded() {
  const db = getDrizzleDatabase();
  const countRow = db.select({ count: count() }).from(catalogOutputStations).get();
  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  const now = Date.now();

  for (const station of defaultOutputStations) {
    db.insert(catalogOutputStations)
      .values({
        id: station.id,
        tenantId: station.tenant_id,
        name: station.name,
        kind: station.kind,
        hasKds: station.has_kds ? 1 : 0,
        hasPrinter: station.has_printer ? 1 : 0,
        isActive: station.is_active ? 1 : 0,
        sortOrder: station.sort_order,
        createdAt: station.created_at || now,
        updatedAt: now
      })
      .onConflictDoNothing()
      .run();
  }
}

function ensureTaxesSeeded() {
  const db = getDrizzleDatabase();
  const rows = db
    .selectDistinct({
      taxCodeId: catalogProducts.taxCodeId,
      taxCodeName: catalogProducts.taxCodeName,
      taxRateBps: catalogProducts.taxRateBps
    })
    .from(catalogProducts)
    .all();
  const taxesById = new Map<string, { id: string; name: string; rate_bps: number }>();

  for (const product of defaultProducts) {
    taxesById.set(product.tax_code_id, { id: product.tax_code_id, name: product.tax_code_name, rate_bps: product.tax_rate_bps });
  }

  for (const row of rows) {
    taxesById.set(row.taxCodeId, { id: row.taxCodeId, name: row.taxCodeName, rate_bps: row.taxRateBps });
  }

  let index = 0;
  for (const tax of taxesById.values()) {
    db.insert(catalogTaxes)
      .values({
        id: tax.id,
        name: tax.name,
        rateBps: tax.rate_bps,
        sortOrder: (index + 1) * 10,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      .onConflictDoNothing()
      .run();
    index += 1;
  }
}

function backfillProductTaxIds() {
  getDrizzleDatabase()
    .update(catalogProducts)
    .set({ taxId: sql`${catalogProducts.taxCodeId}` })
    .where(sql`${catalogProducts.taxId} IS NULL OR ${catalogProducts.taxId} = ''`)
    .run();
}

function createSeedStation(id: string, name: string, kind: CatalogOutputStationKind, sortOrder: number): CatalogOutputStation {
  return { id, tenant_id: tenantId, name, kind, has_kds: true, has_printer: true, is_active: true, sort_order: sortOrder, created_at: 0, updated_at: 0 };
}

function normalizeStationKind(station: CatalogOutputStation): CatalogOutputStationKind {
  if (station.kind) {
    return toOutputStationKind(station.kind);
  }

  if (station.has_kds && station.has_printer) return "KDS_AND_PRINTER";
  if (station.has_kds) return "KDS";
  if (station.has_printer) return "PRINTER";
  return "NONE";
}

function toTimestamp(value: number | string | null | undefined, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function createSeedProduct(id: string, productType: PosProduct["product_type"], name: string, category: string, price: number, taxCodeId: string, taxCodeName: string, taxRateBps: number, stationId: string | null): PosProduct {
  const stationName = stationId ? defaultOutputStations.find((station) => station.id === stationId)?.name ?? null : null;
  return { id, product_type: productType, name, category, price, tax_code_id: taxCodeId, tax_code_name: taxCodeName, tax_rate_bps: taxRateBps, is_available: true, isAvailable: true, station_id: stationId, station_name: stationName, station: stationName ?? "" };
}

function defaultStationForCategory(category: string) {
  return defaultProducts.find((product) => product.category === category && product.station_id)?.station_id ?? null;
}

function withCategoryDefaultStation(request: CatalogProductCreateRequest): CatalogProductCreateRequest {
  if (request.station_id !== undefined) {
    return request;
  }

  const category = requireCategory(request.category_id);
  return { ...request, station_id: category.default_station_id };
}

function normalizeProductInput(request: CatalogProductCreateRequest): Required<CatalogProductCreateRequest> {
  const categoryId = normalizeName(request.category_id, "Category is required.");
  const taxId = normalizeName(request.tax_id, "Tax is required.");
  requireCategory(categoryId);
  requireTax(taxId);

  if (request.product_type !== "BASIC" && request.product_type !== "SERVICE") {
    throw new CatalogError("Product type must be BASIC or SERVICE.");
  }

  return { category_id: categoryId, tax_id: taxId, product_type: request.product_type, name: normalizeName(request.name, "Product name is required."), price: normalizeInteger(request.price, "Price must be a positive integer or zero."), is_available: request.is_available ?? true, station_id: normalizeOptionalStationId(request.station_id) };
}

function requireProduct(productId: string): CatalogProduct {
  const product = getProductById(productId);
  if (!product) throw new CatalogError("Product not found.", 404);
  return product;
}

function requireCategory(categoryId: string): CatalogCategory {
  const category = getCategoryById(categoryId);
  if (!category) throw new CatalogError("Category not found.", 404);
  return category;
}

function requireTax(taxId: string): CatalogTax {
  const tax = getTaxById(taxId);
  if (!tax) throw new CatalogError("Tax not found.", 404);
  return tax;
}

function requireOutputStation(stationId: string): CatalogOutputStation {
  const station = getOutputStationById(stationId);
  if (!station || !station.is_active) throw new CatalogError("Output station not found.", 404);
  return station;
}

function getCategoryById(categoryId: string): CatalogCategory | null {
  const row = getDrizzleDatabase()
    .select(categorySelectFields)
    .from(catalogCategories)
    .leftJoin(catalogProducts, eq(catalogProducts.categoryId, catalogCategories.id))
    .leftJoin(catalogOutputStations, eq(catalogOutputStations.id, catalogCategories.defaultStationId))
    .where(eq(catalogCategories.id, categoryId))
    .groupBy(catalogCategories.id)
    .get();

  return row ? toCatalogCategory(row) : null;
}

function getTaxById(taxId: string): CatalogTax | null {
  const row = getDrizzleDatabase()
    .select(taxSelectFields)
    .from(catalogTaxes)
    .leftJoin(catalogProducts, eq(catalogProducts.taxId, catalogTaxes.id))
    .where(eq(catalogTaxes.id, taxId))
    .groupBy(catalogTaxes.id)
    .get();

  return row ? toCatalogTax(row) : null;
}

function getOutputStationById(stationId: string): CatalogOutputStation | null {
  const row = getDrizzleDatabase()
    .select()
    .from(catalogOutputStations)
    .where(eq(catalogOutputStations.id, stationId))
    .get();

  return row ? toCatalogOutputStation(row) : null;
}

function ensureUniqueCategoryName(name: string, exceptCategoryId?: string) {
  const row = getDrizzleDatabase()
    .select({ id: catalogCategories.id })
    .from(catalogCategories)
    .where(and(sql`lower(${catalogCategories.name}) = lower(${name})`, ne(catalogCategories.id, exceptCategoryId ?? "")))
    .get();

  if (row) throw new CatalogError("Category name already exists.", 409);
}

function ensureUniqueTaxId(taxId: string) {
  const row = getDrizzleDatabase()
    .select({ id: catalogTaxes.id })
    .from(catalogTaxes)
    .where(eq(catalogTaxes.id, taxId))
    .get();

  if (row) throw new CatalogError("Tax id already exists.", 409);
}

function uniqueCategoryName(baseName: string) {
  return uniqueName(baseName, new Set(listCatalogCategories().map((category) => category.name.toLowerCase())));
}

function uniqueProductName(baseName: string) {
  return uniqueName(baseName, new Set(listProducts().map((product) => product.name.toLowerCase())));
}

function uniqueTaxName(baseName: string) {
  return uniqueName(baseName, new Set(listCatalogTaxes().map((tax) => tax.name.toLowerCase())));
}

function uniqueName(baseName: string, existing: Set<string>) {
  let nextName = baseName;
  let index = 2;
  while (existing.has(nextName.toLowerCase())) {
    nextName = baseName + " " + index;
    index += 1;
  }
  return nextName;
}

function nextCategorySortOrder() {
  const row = getDrizzleDatabase()
    .select({ count: sql<number>`COALESCE(MAX(${catalogCategories.sortOrder}), 0) + 10` })
    .from(catalogCategories)
    .get();
  return row?.count ?? 10;
}

function nextTaxSortOrder() {
  const row = getDrizzleDatabase()
    .select({ count: sql<number>`COALESCE(MAX(${catalogTaxes.sortOrder}), 0) + 10` })
    .from(catalogTaxes)
    .get();
  return row?.count ?? 10;
}

function normalizeTaxId(value: string | undefined, name: string) {
  return value?.trim() || "tax_" + slugify(name);
}

function normalizeName(value: string | undefined, message: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new CatalogError(message);
  return normalized;
}

function normalizeInteger(value: number | undefined, message: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new CatalogError(message);
  return value;
}

function normalizeOptionalInteger(value: number | undefined, fallback: number) {
  return value === undefined ? fallback : normalizeInteger(value, "Sort order must be a positive integer or zero.");
}

function normalizeOptionalStationId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function toCatalogProduct(row: CatalogProductRow): CatalogProduct {
  return { id: row.id, product_type: toProductType(row.productType), name: row.name, category_id: row.categoryId, category: row.category, tax_id: row.taxId ?? row.taxCodeId, price: row.price, tax_code_id: row.taxCodeId, tax_code_name: row.taxCodeName, tax_rate_bps: row.taxRateBps, is_available: row.isAvailable === 1, isAvailable: row.isAvailable === 1, station_id: row.stationId, station_name: row.stationName, station: row.stationName ?? "", created_at: row.createdAt, updated_at: row.updatedAt };
}

function toCatalogCategory(row: CatalogCategoryRow): CatalogCategory {
  return { id: row.id, name: row.name, sort_order: row.sortOrder, default_station_id: row.defaultStationId, default_station_name: row.defaultStationName, product_count: row.productCount, created_at: row.createdAt, updated_at: row.updatedAt };
}

function toCatalogTax(row: CatalogTaxRow): CatalogTax {
  return { id: row.id, name: row.name, rate_bps: row.rateBps, sort_order: row.sortOrder, product_count: row.productCount, created_at: row.createdAt, updated_at: row.updatedAt };
}

function toCatalogOutputStation(row: CatalogOutputStationRow): CatalogOutputStation {
  return { id: row.id, tenant_id: row.tenantId, name: row.name, kind: toOutputStationKind(row.kind), has_kds: row.hasKds === 1, has_printer: row.hasPrinter === 1, is_active: row.isActive === 1, sort_order: row.sortOrder, created_at: row.createdAt, updated_at: row.updatedAt };
}

function toProductType(value: string): PosProduct["product_type"] {
  if (value !== "BASIC" && value !== "SERVICE") {
    throw new CatalogError("Stored product type is invalid.", 500);
  }

  return value;
}

function toOutputStationKind(value: string): CatalogOutputStationKind {
  if (value !== "KDS" && value !== "PRINTER" && value !== "KDS_AND_PRINTER" && value !== "NONE") {
    throw new CatalogError("Stored output station kind is invalid.", 500);
  }

  return value;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
