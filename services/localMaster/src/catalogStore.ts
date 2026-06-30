import { randomUUID } from "node:crypto";

import { getDatabase } from "./db.js";
import type {
  CatalogCategory,
  CatalogCategoryCreateRequest,
  CatalogCategoryUpdateRequest,
  CatalogProduct,
  CatalogProductCreateRequest,
  CatalogProductUpdateRequest,
  CatalogTax,
  CatalogTaxCreateRequest,
  CatalogTaxUpdateRequest,
  PosProduct
} from "./types.js";

const defaultProducts: PosProduct[] = [
  createSeedProduct("prod_invoice", "SERVICE", "Rechnung", "Service", 0, "tax_standard_ch", "MwSt 8.1%", 810, "SERVICE"),
  createSeedProduct("prod_service_personal", "SERVICE", "Service Personal", "Service", 0, "tax_standard_ch", "MwSt 8.1%", 810, "SERVICE"),
  createSeedProduct("prod_shisha_standard", "BASIC", "Shisha Standard", "Shisha", 3000, "tax_standard_ch", "MwSt 8.1%", 810, "BAR"),
  createSeedProduct("prod_nava_shisha", "BASIC", "NAVA Shisha", "Shisha", 5900, "tax_standard_ch", "MwSt 8.1%", 810, "BAR"),
  createSeedProduct("prod_smokezilla_laser_shisha", "BASIC", "SmokeZilla Laser Shisha", "Shisha", 8900, "tax_standard_ch", "MwSt 8.1%", 810, "BAR"),
  createSeedProduct("prod_shisha_triple_skull", "BASIC", "Shisha Triple Skull", "Shisha", 4500, "tax_standard_ch", "MwSt 8.1%", 810, "BAR"),
  createSeedProduct("prod_neuer_kopf", "SERVICE", "Neuer Kopf", "Shisha", 1500, "tax_standard_ch", "MwSt 8.1%", 810, "BAR"),
  createSeedProduct("prod_kohle", "SERVICE", "Kohle", "Shisha", 0, "tax_standard_ch", "MwSt 8.1%", 810, "BAR"),
  createSeedProduct("prod_mundstucke", "SERVICE", "Mundstucke", "Shisha", 300, "tax_standard_ch", "MwSt 8.1%", 810, "BAR"),
  createSeedProduct("prod_chinotto", "BASIC", "Chinotto", "Sussgetranke", 700, "tax_standard_ch", "MwSt 8.1%", 810, "BAR")
];

type CatalogProductRow = {
  id: string;
  product_type: "BASIC" | "SERVICE";
  name: string;
  category_id: string;
  category: string;
  tax_id: string | null;
  price: number;
  tax_code_id: string;
  tax_code_name: string;
  tax_rate_bps: number;
  is_available: number;
  station: string;
  created_at: number;
  updated_at: number;
};

type CatalogCategoryRow = {
  id: string;
  name: string;
  sort_order: number;
  product_count: number;
  created_at: number;
  updated_at: number;
};

type CatalogTaxRow = {
  id: string;
  name: string;
  rate_bps: number;
  sort_order: number;
  product_count: number;
  created_at: number;
  updated_at: number;
};

type CountRow = {
  count: number;
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

  const rows = getDatabase()
    .prepare([
      "SELECT p.id, p.product_type, p.name, p.category_id, c.name AS category, p.tax_id, p.price,",
      "p.tax_code_id, p.tax_code_name, p.tax_rate_bps, p.is_available, p.station, p.created_at, p.updated_at",
      "FROM catalog_products p",
      "JOIN catalog_categories c ON c.id = p.category_id",
      "ORDER BY c.sort_order, c.name, p.name"
    ].join(" "))
    .all() as CatalogProductRow[];

  return rows.map(toCatalogProduct);
}

export function getProductById(productId: string): CatalogProduct | null {
  ensureCatalogSeeded();

  const row = getDatabase()
    .prepare([
      "SELECT p.id, p.product_type, p.name, p.category_id, c.name AS category, p.tax_id, p.price,",
      "p.tax_code_id, p.tax_code_name, p.tax_rate_bps, p.is_available, p.station, p.created_at, p.updated_at",
      "FROM catalog_products p",
      "JOIN catalog_categories c ON c.id = p.category_id",
      "WHERE p.id = ?"
    ].join(" "))
    .get(productId) as CatalogProductRow | undefined;

  return row ? toCatalogProduct(row) : null;
}

export function listCatalogCategories(): CatalogCategory[] {
  ensureCatalogSeeded();

  const rows = getDatabase()
    .prepare([
      "SELECT c.id, c.name, c.sort_order, c.created_at, c.updated_at, COUNT(p.id) AS product_count",
      "FROM catalog_categories c",
      "LEFT JOIN catalog_products p ON p.category_id = c.id",
      "GROUP BY c.id",
      "ORDER BY c.sort_order, c.name"
    ].join(" "))
    .all() as CatalogCategoryRow[];

  return rows.map(toCatalogCategory);
}

export function listCatalogTaxes(): CatalogTax[] {
  ensureCatalogSeeded();

  const rows = getDatabase()
    .prepare([
      "SELECT t.id, t.name, t.rate_bps, t.sort_order, t.created_at, t.updated_at, COUNT(p.id) AS product_count",
      "FROM catalog_taxes t",
      "LEFT JOIN catalog_products p ON p.tax_id = t.id",
      "GROUP BY t.id",
      "ORDER BY t.sort_order, t.name"
    ].join(" "))
    .all() as CatalogTaxRow[];

  return rows.map(toCatalogTax);
}

export function createCatalogProduct(request: CatalogProductCreateRequest): CatalogProduct {
  ensureCatalogSeeded();

  const now = Date.now();
  const input = normalizeProductInput(request);
  const tax = requireTax(input.tax_id);
  const id = "prod_" + randomUUID();

  getDatabase()
    .prepare([
      "INSERT INTO catalog_products (id, category_id, tax_id, product_type, name, price, tax_code_id, tax_code_name,",
      "tax_rate_bps, is_available, station, created_at, updated_at)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(" "))
    .run(id, input.category_id, tax.id, input.product_type, input.name, input.price, tax.id, tax.name, tax.rate_bps, input.is_available ? 1 : 0, input.station, now, now);

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
    station: request.station ?? current.station
  });
  const tax = requireTax(input.tax_id);

  getDatabase()
    .prepare([
      "UPDATE catalog_products SET category_id = ?, tax_id = ?, product_type = ?, name = ?, price = ?, tax_code_id = ?,",
      "tax_code_name = ?, tax_rate_bps = ?, is_available = ?, station = ?, updated_at = ? WHERE id = ?"
    ].join(" "))
    .run(input.category_id, tax.id, input.product_type, input.name, input.price, tax.id, tax.name, tax.rate_bps, input.is_available ? 1 : 0, input.station, Date.now(), productId);

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
    station: current.station
  });
}

export function deleteCatalogProduct(productId: string) {
  ensureCatalogSeeded();
  requireProduct(productId);

  getDatabase().prepare("DELETE FROM catalog_products WHERE id = ?").run(productId);
}

export function createCatalogCategory(request: CatalogCategoryCreateRequest): CatalogCategory {
  ensureCatalogSeeded();

  const now = Date.now();
  const name = normalizeName(request.name, "Category name is required.");
  ensureUniqueCategoryName(name);
  const sortOrder = normalizeOptionalInteger(request.sort_order, nextCategorySortOrder());
  const id = "cat_" + randomUUID();

  getDatabase()
    .prepare("INSERT INTO catalog_categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, sortOrder, now, now);

  return requireCategory(id);
}

export function updateCatalogCategory(categoryId: string, request: CatalogCategoryUpdateRequest): CatalogCategory {
  ensureCatalogSeeded();
  const current = requireCategory(categoryId);
  const name = request.name === undefined ? current.name : normalizeName(request.name, "Category name is required.");
  const sortOrder = request.sort_order === undefined ? current.sort_order : normalizeOptionalInteger(request.sort_order, current.sort_order);

  if (name !== current.name) {
    ensureUniqueCategoryName(name, categoryId);
  }

  getDatabase()
    .prepare("UPDATE catalog_categories SET name = ?, sort_order = ?, updated_at = ? WHERE id = ?")
    .run(name, sortOrder, Date.now(), categoryId);

  return requireCategory(categoryId);
}

export function duplicateCatalogCategory(categoryId: string): CatalogCategory {
  const current = requireCategory(categoryId);

  return createCatalogCategory({ name: uniqueCategoryName(current.name + " Kopie"), sort_order: current.sort_order + 1 });
}

export function deleteCatalogCategory(categoryId: string) {
  ensureCatalogSeeded();
  requireCategory(categoryId);

  const row = getDatabase().prepare("SELECT COUNT(*) AS count FROM catalog_products WHERE category_id = ?").get(categoryId) as CountRow;

  if (row.count > 0) {
    throw new CatalogError("Category still has products assigned.", 409);
  }

  getDatabase().prepare("DELETE FROM catalog_categories WHERE id = ?").run(categoryId);
}

export function createCatalogTax(request: CatalogTaxCreateRequest): CatalogTax {
  ensureCatalogSeeded();

  const now = Date.now();
  const id = normalizeTaxId(request.id, request.name);
  const name = normalizeName(request.name, "Tax name is required.");
  const rateBps = normalizeInteger(request.rate_bps, "Tax rate must be a positive integer or zero.");
  const sortOrder = normalizeOptionalInteger(request.sort_order, nextTaxSortOrder());
  ensureUniqueTaxId(id);

  getDatabase()
    .prepare("INSERT INTO catalog_taxes (id, name, rate_bps, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, name, rateBps, sortOrder, now, now);

  return requireTax(id);
}

export function updateCatalogTax(taxId: string, request: CatalogTaxUpdateRequest): CatalogTax {
  ensureCatalogSeeded();
  const current = requireTax(taxId);
  const name = request.name === undefined ? current.name : normalizeName(request.name, "Tax name is required.");
  const rateBps = request.rate_bps === undefined ? current.rate_bps : normalizeInteger(request.rate_bps, "Tax rate must be a positive integer or zero.");
  const sortOrder = request.sort_order === undefined ? current.sort_order : normalizeOptionalInteger(request.sort_order, current.sort_order);
  const now = Date.now();

  getDatabase().prepare("UPDATE catalog_taxes SET name = ?, rate_bps = ?, sort_order = ?, updated_at = ? WHERE id = ?").run(name, rateBps, sortOrder, now, taxId);
  getDatabase().prepare("UPDATE catalog_products SET tax_code_name = ?, tax_rate_bps = ?, updated_at = ? WHERE tax_id = ?").run(name, rateBps, now, taxId);

  return requireTax(taxId);
}

export function duplicateCatalogTax(taxId: string): CatalogTax {
  const current = requireTax(taxId);

  return createCatalogTax({ name: uniqueTaxName(current.name + " Kopie"), rate_bps: current.rate_bps, sort_order: current.sort_order + 1 });
}

export function deleteCatalogTax(taxId: string) {
  ensureCatalogSeeded();
  requireTax(taxId);

  const row = getDatabase().prepare("SELECT COUNT(*) AS count FROM catalog_products WHERE tax_id = ?").get(taxId) as CountRow;

  if (row.count > 0) {
    throw new CatalogError("Tax is still assigned to products.", 409);
  }

  getDatabase().prepare("DELETE FROM catalog_taxes WHERE id = ?").run(taxId);
}

function ensureCatalogSeeded() {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) AS count FROM catalog_categories").get() as CountRow;

  if (row.count === 0) {
    seedCategoriesAndProducts(db);
  }

  ensureTaxesSeeded();
  backfillProductTaxIds();
}

function seedCategoriesAndProducts(db = getDatabase()) {
  const now = Date.now();
  const categories = Array.from(new Set(defaultProducts.map((product) => product.category)));
  const categoryIdsByName = new Map<string, string>();

  db.exec("BEGIN");
  try {
    categories.forEach((name, index) => {
      const id = "cat_" + slugify(name);
      categoryIdsByName.set(name, id);
      db.prepare("INSERT INTO catalog_categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, name, (index + 1) * 10, now, now);
    });

    for (const product of defaultProducts) {
      db.prepare([
        "INSERT INTO catalog_products (id, category_id, tax_id, product_type, name, price, tax_code_id, tax_code_name,",
        "tax_rate_bps, is_available, station, created_at, updated_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ].join(" ")).run(product.id, categoryIdsByName.get(product.category) ?? "", product.tax_code_id, product.product_type, product.name, product.price, product.tax_code_id, product.tax_code_name, product.tax_rate_bps, product.is_available ? 1 : 0, product.station, now, now);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function ensureTaxesSeeded() {
  const db = getDatabase();
  const rows = db.prepare("SELECT DISTINCT tax_code_id, tax_code_name, tax_rate_bps FROM catalog_products").all() as Array<{ tax_code_id: string; tax_code_name: string; tax_rate_bps: number }>;
  const taxesById = new Map<string, { id: string; name: string; rate_bps: number }>();

  for (const product of defaultProducts) {
    taxesById.set(product.tax_code_id, { id: product.tax_code_id, name: product.tax_code_name, rate_bps: product.tax_rate_bps });
  }

  for (const row of rows) {
    taxesById.set(row.tax_code_id, { id: row.tax_code_id, name: row.tax_code_name, rate_bps: row.tax_rate_bps });
  }

  let index = 0;
  for (const tax of taxesById.values()) {
    db.prepare([
      "INSERT INTO catalog_taxes (id, name, rate_bps, sort_order, created_at, updated_at)",
      "VALUES (?, ?, ?, ?, ?, ?)",
      "ON CONFLICT(id) DO NOTHING"
    ].join(" ")).run(tax.id, tax.name, tax.rate_bps, (index + 1) * 10, Date.now(), Date.now());
    index += 1;
  }
}

function backfillProductTaxIds() {
  getDatabase().prepare("UPDATE catalog_products SET tax_id = tax_code_id WHERE tax_id IS NULL OR tax_id = ''").run();
}

function createSeedProduct(id: string, productType: PosProduct["product_type"], name: string, category: string, price: number, taxCodeId: string, taxCodeName: string, taxRateBps: number, station: string): PosProduct {
  return { id, product_type: productType, name, category, price, tax_code_id: taxCodeId, tax_code_name: taxCodeName, tax_rate_bps: taxRateBps, is_available: true, isAvailable: true, station };
}

function normalizeProductInput(request: CatalogProductCreateRequest): Required<CatalogProductCreateRequest> {
  const categoryId = normalizeName(request.category_id, "Category is required.");
  const taxId = normalizeName(request.tax_id, "Tax is required.");
  requireCategory(categoryId);
  requireTax(taxId);

  if (request.product_type !== "BASIC" && request.product_type !== "SERVICE") {
    throw new CatalogError("Product type must be BASIC or SERVICE.");
  }

  return { category_id: categoryId, tax_id: taxId, product_type: request.product_type, name: normalizeName(request.name, "Product name is required."), price: normalizeInteger(request.price, "Price must be a positive integer or zero."), is_available: request.is_available ?? true, station: normalizeName(request.station, "Station is required.") };
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

function getCategoryById(categoryId: string): CatalogCategory | null {
  const row = getDatabase().prepare(["SELECT c.id, c.name, c.sort_order, c.created_at, c.updated_at, COUNT(p.id) AS product_count", "FROM catalog_categories c", "LEFT JOIN catalog_products p ON p.category_id = c.id", "WHERE c.id = ?", "GROUP BY c.id"].join(" ")).get(categoryId) as CatalogCategoryRow | undefined;
  return row ? toCatalogCategory(row) : null;
}

function getTaxById(taxId: string): CatalogTax | null {
  const row = getDatabase().prepare(["SELECT t.id, t.name, t.rate_bps, t.sort_order, t.created_at, t.updated_at, COUNT(p.id) AS product_count", "FROM catalog_taxes t", "LEFT JOIN catalog_products p ON p.tax_id = t.id", "WHERE t.id = ?", "GROUP BY t.id"].join(" ")).get(taxId) as CatalogTaxRow | undefined;
  return row ? toCatalogTax(row) : null;
}

function ensureUniqueCategoryName(name: string, exceptCategoryId?: string) {
  const row = getDatabase().prepare("SELECT id FROM catalog_categories WHERE lower(name) = lower(?) AND id != ?").get(name, exceptCategoryId ?? "") as { id: string } | undefined;
  if (row) throw new CatalogError("Category name already exists.", 409);
}

function ensureUniqueTaxId(taxId: string) {
  const row = getDatabase().prepare("SELECT id FROM catalog_taxes WHERE id = ?").get(taxId) as { id: string } | undefined;
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
  const row = getDatabase().prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS count FROM catalog_categories").get() as CountRow;
  return row.count;
}

function nextTaxSortOrder() {
  const row = getDatabase().prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS count FROM catalog_taxes").get() as CountRow;
  return row.count;
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

function toCatalogProduct(row: CatalogProductRow): CatalogProduct {
  return { id: row.id, product_type: row.product_type, name: row.name, category_id: row.category_id, category: row.category, tax_id: row.tax_id ?? row.tax_code_id, price: row.price, tax_code_id: row.tax_code_id, tax_code_name: row.tax_code_name, tax_rate_bps: row.tax_rate_bps, is_available: row.is_available === 1, isAvailable: row.is_available === 1, station: row.station, created_at: row.created_at, updated_at: row.updated_at };
}

function toCatalogCategory(row: CatalogCategoryRow): CatalogCategory {
  return { id: row.id, name: row.name, sort_order: row.sort_order, product_count: row.product_count, created_at: row.created_at, updated_at: row.updated_at };
}

function toCatalogTax(row: CatalogTaxRow): CatalogTax {
  return { id: row.id, name: row.name, rate_bps: row.rate_bps, sort_order: row.sort_order, product_count: row.product_count, created_at: row.created_at, updated_at: row.updated_at };
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
