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
  station_id: string | null;
  station_name: string | null;
  station: string;
  created_at?: number;
  updated_at?: number;
};

export type CatalogOutputStation = {
  id: string;
  tenant_id: string;
  name: string;
  kind: "KDS" | "PRINTER" | "KDS_AND_PRINTER" | "NONE";
  is_active: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export type CatalogCategory = {
  id: string;
  name: string;
  sort_order: number;
  default_station_id: string | null;
  default_station_name: string | null;
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
  station_id?: string | null;
};

export type CatalogCategoryInput = {
  name: string;
  sort_order?: number;
  default_station_id?: string | null;
};

export type CatalogTaxInput = {
  id?: string;
  name: string;
  rate_bps: number;
  sort_order?: number;
};

export type StaffProduct = {
  id: string;
  product_type: CatalogProductType;
  name: string;
  category: string;
  price: number;
  tax_code_id: string;
  tax_code_name: string;
  tax_rate_bps: number;
  is_available: boolean;
  station: string;
};

export type ProductVariantGroupItem = {
  id: string;
  variant_group_id: string;
  name: string;
  price_delta: number;
  is_default: boolean;
  sort_order: number;
};

export type ProductVariantGroup = {
  id: string;
  applies_to: "PRODUCT" | "CATEGORY";
  product_id: string | null;
  category: string | null;
  name: string;
  selection_type: "SINGLE" | "MULTIPLE";
  min_select: number;
  max_select: number;
  sort_order: number;
  is_required: boolean;
  items: ProductVariantGroupItem[];
};

export type BasketLineVariant = {
  variant_group_id: string;
  variant_group_name: string;
  variant_item_id: string;
  variant_item_name: string;
  price_delta: number;
};

export type BasketLine = {
  id: string;
  product_id: string;
  product_type: StaffProduct["product_type"];
  product_name: string;
  product_category: string;
  base_price: number;
  tax_code_id: string;
  tax_code_name: string;
  tax_rate_bps: number;
  station: string;
  variants: BasketLineVariant[];
  unit_total: number;
  quantity: number;
  line_total: number;
};

export type CreatedOrderSnapshot = {
  id: string;
  order_number: string;
  status: "OPEN" | string;
  payment_status: "UNPAID" | string;
  subtotal: number;
  tax_total: number;
  total: number;
  created_at: number;
  table_id: string | null;
  table_name: string | null;
  continued_existing_order: boolean;
};

export type OpenTableOrderBasket = {
  order_id: string;
  order_number: string;
  lines: BasketLine[];
};

export type TableContext = {
  tenant_id: string;
  location_id: string;
  floor_id: string;
  area_id: string;
  table_id: string;
  table_name: string;
  area_name: string;
  floor_name: string;
  seats: number;
};

export type TableLayout = {
  tenant: {
    id: string;
    name: string;
  };
  location: {
    id: string;
    tenant_id: string;
    name: string;
  };
  floors: TableLayoutFloor[];
};

export type TableLayoutFloor = {
  id: string;
  location_id: string;
  name: string;
  sort_order: number;
  areas: TableLayoutArea[];
};

export type TableLayoutArea = {
  id: string;
  floor_id: string;
  name: string;
  sort_order: number;
  tables: TableLayoutTable[];
};

export type TableLayoutTable = {
  id: string;
  area_id: string;
  name: string;
  seats: number;
  sort_order: number;
  open_order_id: string | null;
  open_order_number: string | null;
  open_total: number;
  open_order_count: number;
};

export type LocalMasterEvent = {
  id?: string;
  type: string;
  createdAt?: number;
  payload?: unknown;
};

export type StationPickupStatus = "READY" | "ACKNOWLEDGED";

export type StationPickupItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  variants: BasketLineVariant[];
};

export type StationPickup = {
  id: string;
  order_id: string;
  order_number: string;
  table_id: string;
  table_name: string;
  station: string;
  status: StationPickupStatus;
  items: StationPickupItem[];
  ready_at: number;
  acknowledged_at: number | null;
};

export type KdsTicketStatus = "OPEN" | "IN_PROGRESS" | "DONE";

export type KdsTicketItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  variants: BasketLineVariant[];
};

export type KdsTicket = {
  id: string;
  order_id: string;
  order_number: string;
  table_id: string;
  table_name: string;
  station: string;
  status: KdsTicketStatus;
  items: KdsTicketItem[];
  created_at: number;
  updated_at: number;
  done_at: number | null;
};

export type LocationServiceMode = "TABLE_SERVICE" | "COUNTER_SERVICE";

export type PosPeripheralSettings = {
  enabled: boolean;
  provider: string;
  device_id: string | null;
};

export type PosSettings = {
  schema_version: number;
  tenant_id: string;
  location_id: string;
  service_mode: LocationServiceMode;
  language: string;
  business_day_cutover_time: string;
  receipt_printer: PosPeripheralSettings;
  payment_terminal: PosPeripheralSettings;
};

export type PosSettingsFile = {
  path: string;
  settings: PosSettings;
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

export function loadPosSettings() {
  return readJson<PosSettingsFile>("/api/pos-settings", {
    path: "local-master://settings/pos-settings.json",
    settings: {
      schema_version: 1,
      tenant_id: "",
      location_id: "",
      service_mode: "TABLE_SERVICE",
      language: "de-CH",
      business_day_cutover_time: "00:00",
      receipt_printer: { enabled: false, provider: "none", device_id: null },
      payment_terminal: { enabled: false, provider: "none", device_id: null },
    },
  });
}

export function loadTableLayout() {
  return readJson<TableLayout>("/api/table-layout", {
    tenant: { id: "", name: "" },
    location: { id: "", tenant_id: "", name: "" },
    floors: [],
  });
}

export function loadProducts() {
  return readJson<StaffProduct[]>("/api/products", []);
}

export function loadProductVariantGroups(productId: string) {
  return readJson<ProductVariantGroup[]>("/api/product-variant-groups/" + encodeURIComponent(productId), []);
}

export function loadOpenTableOrderBasket(tableId: string) {
  return readJson<OpenTableOrderBasket | null>("/api/tables/" + encodeURIComponent(tableId) + "/open-basket", null);
}

export function createOrderSnapshot(request: {
  lines: BasketLine[];
  table_context: TableContext;
}) {
  return writeJson<CreatedOrderSnapshot>("/api/order-snapshots", "POST", { request });
}

export function loadStationPickups(status: StationPickupStatus | "ALL" = "READY") {
  return readJson<StationPickup[]>("/api/station-pickups?status=" + encodeURIComponent(status), []);
}

export function acknowledgeStationPickup(pickupId: string) {
  return writeJson<StationPickup>("/api/station-pickups/" + encodeURIComponent(pickupId) + "/acknowledge", "POST");
}

export function loadKdsTickets(station?: string) {
  const query = station ? "?station=" + encodeURIComponent(station) : "";

  return readJson<KdsTicket[]>("/api/kds-tickets" + query, []);
}

export function updateKdsTicketStatus(ticketId: string, status: KdsTicketStatus) {
  return writeJson<KdsTicket>("/api/kds-tickets/" + encodeURIComponent(ticketId) + "/status", "POST", { request: { status } });
}

export function subscribeLocalMasterEvents(onEvent: (event: LocalMasterEvent) => void) {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let shouldReconnect = true;

  function connect() {
    const apiUrl = new URL(getLocalMasterUrl());
    apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
    apiUrl.pathname = "/realtime";
    apiUrl.search = "";
    apiUrl.hash = "";

    socket = new WebSocket(apiUrl.toString());

    socket.addEventListener("open", () => {
      socket?.send(JSON.stringify({ type: "HELLO", payload: { role: "STAFF", deviceId: "staff-web" } }));
    });

    socket.addEventListener("message", (message) => {
      if (typeof message.data !== "string") {
        return;
      }

      try {
        onEvent(JSON.parse(message.data) as LocalMasterEvent);
      } catch (error) {
        console.warn("Could not parse Local Master realtime event.", error);
      }
    });

    socket.addEventListener("close", () => {
      if (shouldReconnect) {
        reconnectTimer = window.setTimeout(connect, 1_000);
      }
    });

    socket.addEventListener("error", () => {
      socket?.close();
    });
  }

  connect();

  return () => {
    shouldReconnect = false;

    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer);
    }

    socket?.close();
  };
}

export function loadCatalogCategories() {
  return readJson<CatalogCategory[]>("/api/catalog/categories", []);
}

export function loadCatalogTaxes() {
  return readJson<CatalogTax[]>("/api/catalog/taxes", []);
}

export function loadCatalogOutputStations() {
  return readJson<CatalogOutputStation[]>("/api/catalog/output-stations", []);
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
