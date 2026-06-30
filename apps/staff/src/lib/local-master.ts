export type CatalogProductType = "BASIC" | "SERVICE";

export type CatalogProduct = {
  id: string;
  category_id: string;
  tax_id: string;
  product_type: CatalogProductType;
  name: string;
  category: string;
  price: number;
  tax_code_id: string;
  tax_code_name: string;
  tax_rate_bps: number;
  is_available: boolean;
  isAvailable?: boolean;
  station: string;
  created_at?: number;
  updated_at?: number;
};

export type CatalogCategory = {
  id: string;
  name: string;
  sort_order: number;
  product_count: number;
  created_at: number;
  updated_at: number;
};

export type CatalogTax = {
  id: string;
  name: string;
  rate_bps: number;
  sort_order: number;
  product_count: number;
  created_at: number;
  updated_at: number;
};

export type CatalogProductInput = {
  category_id: string;
  tax_id: string;
  product_type: CatalogProductType;
  name: string;
  price: number;
  is_available: boolean;
  station: string;
};

export type CatalogCategoryInput = {
  name: string;
  sort_order?: number;
};

export type CatalogTaxInput = {
  id?: string;
  name: string;
  rate_bps: number;
  sort_order?: number;
};

const configuredUrl = import.meta.env.VITE_LOCAL_REALTIME_URL as string | undefined;

export function getLocalMasterUrl() {
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

export function loadCatalog() {
  return readJson<CatalogProduct[]>("/api/catalog", []);
}

export function loadCatalogCategories() {
  return readJson<CatalogCategory[]>("/api/catalog/categories", []);
}

export function loadCatalogTaxes() {
  return readJson<CatalogTax[]>("/api/catalog/taxes", []);
}

export function createCatalogProduct(input: CatalogProductInput) {
  return writeJson<CatalogProduct>("/api/catalog/products", "POST", input);
}

export function updateCatalogProduct(productId: string, input: Partial<CatalogProductInput>) {
  return writeJson<CatalogProduct>("/api/catalog/products/" + encodeURIComponent(productId), "PATCH", input);
}

export function deleteCatalogProduct(productId: string) {
  return writeJson<void>("/api/catalog/products/" + encodeURIComponent(productId), "DELETE");
}

export function duplicateCatalogProduct(productId: string) {
  return writeJson<CatalogProduct>("/api/catalog/products/" + encodeURIComponent(productId) + "/duplicate", "POST");
}

export function createCatalogCategory(input: CatalogCategoryInput) {
  return writeJson<CatalogCategory>("/api/catalog/categories", "POST", input);
}

export function updateCatalogCategory(categoryId: string, input: Partial<CatalogCategoryInput>) {
  return writeJson<CatalogCategory>("/api/catalog/categories/" + encodeURIComponent(categoryId), "PATCH", input);
}

export function deleteCatalogCategory(categoryId: string) {
  return writeJson<void>("/api/catalog/categories/" + encodeURIComponent(categoryId), "DELETE");
}

export function duplicateCatalogCategory(categoryId: string) {
  return writeJson<CatalogCategory>("/api/catalog/categories/" + encodeURIComponent(categoryId) + "/duplicate", "POST");
}

export function createCatalogTax(input: CatalogTaxInput) {
  return writeJson<CatalogTax>("/api/catalog/taxes", "POST", input);
}

export function updateCatalogTax(taxId: string, input: Partial<CatalogTaxInput>) {
  return writeJson<CatalogTax>("/api/catalog/taxes/" + encodeURIComponent(taxId), "PATCH", input);
}

export function deleteCatalogTax(taxId: string) {
  return writeJson<void>("/api/catalog/taxes/" + encodeURIComponent(taxId), "DELETE");
}

export function duplicateCatalogTax(taxId: string) {
  return writeJson<CatalogTax>("/api/catalog/taxes/" + encodeURIComponent(taxId) + "/duplicate", "POST");
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const response = await fetch(`${getLocalMasterUrl()}${path}`);
  return parseJsonResponse(response, fallback);
}

async function writeJson<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(`${getLocalMasterUrl()}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return parseJsonResponse(response, undefined as T);
}

async function parseJsonResponse<T>(response: Response, fallback: T): Promise<T> {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? message;
    } catch {
      message = (await response.text().catch(() => "")) || message;
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return fallback;
  }

  const payload = (await response.json()) as unknown;

  if (Array.isArray(payload)) {
    return payload as T;
  }

  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }

  return (payload as T) ?? fallback;
}