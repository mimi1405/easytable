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

export type ConnectionMode = "LOCAL" | "RELAY" | "OFFLINE";

export type StaffRelayCommand = {
  command_id: string;
  status: "pending" | "delivered" | "accepted" | "failed";
  result: unknown | null;
  poll_url: string;
};

export type OwnerCatalogSnapshot = {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  taxes: CatalogTax[];
  output_stations: CatalogOutputStation[];
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

export type OwnerLocation = {
  id: string;
  tenant_id: string;
  name: string;
};

export type LayoutFloorInput = {
  name: string;
  sort_order?: number;
};

export type LayoutAreaInput = {
  floor_id: string;
  name: string;
  sort_order?: number;
};

export type LayoutTableInput = {
  area_id: string;
  name: string;
  seats: number;
  sort_order?: number;
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

type LocalMasterIdentity = {
  ok: boolean;
  service: "localMaster";
  instance_id: string;
  location_id: string;
  port: number;
  version: string;
};

const configuredUrl = import.meta.env.VITE_LOCAL_REALTIME_URL as string | undefined;
const configuredRelayUrl = import.meta.env.VITE_RELAY_SYNC_URL as string | undefined;
const configuredRelayLocationId = import.meta.env.VITE_RELAY_LOCATION_ID as string | undefined;

export function getLocalMasterUrl() {
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

export function getRelaySyncUrl() {
  return configuredRelayUrl?.replace(/\/$/, "") ?? "";
}

export async function detectConnectionMode(): Promise<ConnectionMode> {
  if (await canReachExpectedLocalMaster()) {
    return "LOCAL";
  }

  return getRelaySyncUrl() && configuredRelayLocationId ? "RELAY" : "OFFLINE";
}

export async function canReachLocalMaster() {
  return (await readLocalMasterIdentity()) !== null;
}

export async function canReachExpectedLocalMaster() {
  const identity = await readLocalMasterIdentity();
  if (!identity) {
    return false;
  }

  if (configuredRelayLocationId && identity.location_id !== configuredRelayLocationId) {
    return false;
  }

  return true;
}

async function readLocalMasterIdentity() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 700);

  try {
    const response = await fetch(`${getLocalMasterUrl()}/api/local-master/identity`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as LocalMasterIdentity;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
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

export function loadTableLayoutForConnection(connectionMode: ConnectionMode) {
  if (connectionMode === "LOCAL") {
    return loadTableLayout();
  }

  if (connectionMode === "RELAY") {
    return loadRelayTableLayout();
  }

  throw new Error(describeConnectionUnavailable());
}

export function loadRelayTableLayout() {
  const locationId = requireStaffRelayLocationId();

  return readRelayJson<TableLayout>(
    "/api/staff/locations/" + encodeURIComponent(locationId) + "/table-layout",
  );
}

export function loadOwnerLocations() {
  return readJson<OwnerLocation[]>("/api/owner/locations", []);
}

export function loadOwnerTableLayout(locationId: string) {
  return readJson<TableLayout>("/api/owner/locations/" + encodeURIComponent(locationId) + "/table-layout", {
    tenant: { id: "", name: "" },
    location: { id: locationId, tenant_id: "", name: "" },
    floors: [],
  });
}

export function loadProducts() {
  return readJson<StaffProduct[]>("/api/products", []);
}

export function loadProductsForConnection(connectionMode: ConnectionMode) {
  if (connectionMode === "LOCAL") {
    return loadProducts();
  }

  if (connectionMode === "RELAY") {
    const locationId = requireStaffRelayLocationId();
    return readRelayJson<StaffProduct[]>("/api/staff/locations/" + encodeURIComponent(locationId) + "/products");
  }

  throw new Error(describeConnectionUnavailable());
}

export function loadProductVariantGroups(productId: string) {
  return readJson<ProductVariantGroup[]>("/api/product-variant-groups/" + encodeURIComponent(productId), []);
}

export function loadProductVariantGroupsForConnection(connectionMode: ConnectionMode, productId: string) {
  if (connectionMode === "LOCAL") {
    return loadProductVariantGroups(productId);
  }

  if (connectionMode === "RELAY") {
    const locationId = requireStaffRelayLocationId();
    return readRelayJson<ProductVariantGroup[]>(
      "/api/staff/locations/" + encodeURIComponent(locationId) + "/product-variant-groups/" + encodeURIComponent(productId),
    );
  }

  throw new Error(describeConnectionUnavailable());
}

export function loadOpenTableOrderBasket(tableId: string) {
  return readJson<OpenTableOrderBasket | null>("/api/tables/" + encodeURIComponent(tableId) + "/open-basket", null);
}

export function loadOpenTableOrderBasketForConnection(connectionMode: ConnectionMode, tableId: string) {
  if (connectionMode === "LOCAL") {
    return loadOpenTableOrderBasket(tableId);
  }

  if (connectionMode === "RELAY") {
    const locationId = requireStaffRelayLocationId();
    return readRelayJson<OpenTableOrderBasket | null>(
      "/api/staff/locations/" + encodeURIComponent(locationId) + "/tables/" + encodeURIComponent(tableId) + "/open-basket",
    );
  }

  throw new Error(describeConnectionUnavailable());
}

export function createOrderSnapshot(request: {
  request_id?: string;
  lines: BasketLine[];
  table_context: TableContext;
}) {
  return writeJson<CreatedOrderSnapshot>("/api/order-snapshots", "POST", { request: withOrderRequestId(request) });
}

export async function createOrderSnapshotForConnection(
  connectionMode: ConnectionMode,
  request: {
    request_id?: string;
    lines: BasketLine[];
    table_context: TableContext;
  },
) {
  const requestWithId = withOrderRequestId(request);

  if (connectionMode === "LOCAL") {
    return createOrderSnapshot(requestWithId);
  }

  if (connectionMode !== "RELAY") {
    throw new Error("Keine Verbindung zu LocalMaster oder Relay.");
  }

  return createRelayOrderSnapshot(requestWithId);
}

export function describeConnectionUnavailable() {
  if (!getRelaySyncUrl()) {
    return "LocalMaster nicht erreichbar und Relay-URL fehlt.";
  }

  if (!configuredRelayLocationId) {
    return "LocalMaster nicht erreichbar und Relay-Location fehlt.";
  }

  return "Keine Verbindung zu LocalMaster oder Relay.";
}

function requireStaffRelayLocationId() {
  if (!configuredRelayLocationId) {
    throw new Error("Relay-Location fehlt.");
  }
  return configuredRelayLocationId;
}

async function createRelayOrderSnapshot(request: {
  request_id: string;
  lines: BasketLine[];
  table_context: TableContext;
}) {
  const command = await writeRelayJson<StaffRelayCommand>(
    "/api/staff/locations/" + encodeURIComponent(request.table_context.location_id) + "/order-snapshots",
    "POST",
    request,
  );

  return waitForRelayOrderAccepted(command);
}

async function waitForRelayOrderAccepted(command: StaffRelayCommand): Promise<CreatedOrderSnapshot> {
  let current = command;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (current.status === "accepted") {
      return current.result as CreatedOrderSnapshot;
    }

    if (current.status === "failed") {
      const result = current.result as { error?: string } | null;
      throw new Error(result?.error ?? "Relay Command fehlgeschlagen.");
    }

    await new Promise((resolve) => window.setTimeout(resolve, 750));
    current = await readRelayJson<StaffRelayCommand>(current.poll_url);
  }

  throw new Error("Relay Command wartet noch auf LocalMaster.");
}

export function loadStationPickups(status: StationPickupStatus | "ALL" = "READY") {
  return readJson<StationPickup[]>("/api/station-pickups?status=" + encodeURIComponent(status), []);
}

export function loadStationPickupsForConnection(connectionMode: ConnectionMode, status: StationPickupStatus | "ALL" = "READY") {
  if (connectionMode === "LOCAL") {
    return loadStationPickups(status);
  }

  if (connectionMode === "RELAY") {
    const locationId = requireStaffRelayLocationId();
    return readRelayJson<StationPickup[]>(
      "/api/staff/locations/" + encodeURIComponent(locationId) + "/station-pickups?status=" + encodeURIComponent(status),
    );
  }

  throw new Error(describeConnectionUnavailable());
}

export function acknowledgeStationPickup(pickupId: string) {
  return writeJson<StationPickup>("/api/station-pickups/" + encodeURIComponent(pickupId) + "/acknowledge", "POST");
}

export async function acknowledgeStationPickupForConnection(connectionMode: ConnectionMode, pickupId: string) {
  if (connectionMode === "LOCAL") {
    return acknowledgeStationPickup(pickupId);
  }

  if (connectionMode === "RELAY") {
    const locationId = requireStaffRelayLocationId();
    const command = await writeRelayJson<StaffRelayCommand>(
      "/api/staff/locations/" + encodeURIComponent(locationId) + "/station-pickups/" + encodeURIComponent(pickupId) + "/acknowledge",
      "POST",
      { request_id: "pickup_ack_" + crypto.randomUUID() },
    );
    return waitForRelayCommandAccepted(command) as Promise<StationPickup>;
  }

  throw new Error(describeConnectionUnavailable());
}

export function loadKdsTickets(station?: string) {
  const query = station ? "?station=" + encodeURIComponent(station) : "";

  return readJson<KdsTicket[]>("/api/kds-tickets" + query, []);
}

export function loadKdsTicketsForConnection(connectionMode: ConnectionMode, station?: string) {
  if (connectionMode === "LOCAL") {
    return loadKdsTickets(station);
  }

  if (connectionMode === "RELAY") {
    const locationId = requireStaffRelayLocationId();
    const query = station ? "?station=" + encodeURIComponent(station) : "";
    return readRelayJson<KdsTicket[]>(
      "/api/staff/locations/" + encodeURIComponent(locationId) + "/kds-tickets" + query,
    );
  }

  throw new Error(describeConnectionUnavailable());
}

export function updateKdsTicketStatus(ticketId: string, status: KdsTicketStatus) {
  return writeJson<KdsTicket>("/api/kds-tickets/" + encodeURIComponent(ticketId) + "/status", "POST", { request: { status } });
}

export async function updateKdsTicketStatusForConnection(
  connectionMode: ConnectionMode,
  ticketId: string,
  status: KdsTicketStatus,
) {
  if (connectionMode === "LOCAL") {
    return updateKdsTicketStatus(ticketId, status);
  }

  if (connectionMode === "RELAY") {
    const locationId = requireStaffRelayLocationId();
    const command = await writeRelayJson<StaffRelayCommand>(
      "/api/staff/locations/" + encodeURIComponent(locationId) + "/kds-tickets/" + encodeURIComponent(ticketId) + "/status",
      "POST",
      { request_id: "kds_status_" + crypto.randomUUID(), status },
    );
    return waitForRelayCommandAccepted(command) as Promise<KdsTicket>;
  }

  throw new Error(describeConnectionUnavailable());
}

export function createLayoutFloor(locationId: string, input: LayoutFloorInput) {
  return writeJson<TableLayoutFloor>("/api/owner/locations/" + encodeURIComponent(locationId) + "/floors", "POST", input);
}

export function updateLayoutFloor(locationId: string, floorId: string, input: Partial<LayoutFloorInput>) {
  return writeJson<TableLayoutFloor>(
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/floors/" + encodeURIComponent(floorId),
    "PATCH",
    input,
  );
}

export function deleteLayoutFloor(locationId: string, floorId: string) {
  return writeJson<void>(
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/floors/" + encodeURIComponent(floorId),
    "DELETE",
  );
}

export function createLayoutArea(locationId: string, input: LayoutAreaInput) {
  return writeJson<TableLayoutArea>("/api/owner/locations/" + encodeURIComponent(locationId) + "/areas", "POST", input);
}

export function updateLayoutArea(locationId: string, areaId: string, input: Partial<LayoutAreaInput>) {
  return writeJson<TableLayoutArea>(
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/areas/" + encodeURIComponent(areaId),
    "PATCH",
    input,
  );
}

export function deleteLayoutArea(locationId: string, areaId: string) {
  return writeJson<void>(
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/areas/" + encodeURIComponent(areaId),
    "DELETE",
  );
}

export function createLayoutTable(locationId: string, input: LayoutTableInput) {
  return writeJson<TableLayoutTable>("/api/owner/locations/" + encodeURIComponent(locationId) + "/tables", "POST", input);
}

export function updateLayoutTable(locationId: string, tableId: string, input: Partial<LayoutTableInput>) {
  return writeJson<TableLayoutTable>(
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/tables/" + encodeURIComponent(tableId),
    "PATCH",
    input,
  );
}

export function deleteLayoutTable(locationId: string, tableId: string) {
  return writeJson<void>(
    "/api/owner/locations/" + encodeURIComponent(locationId) + "/tables/" + encodeURIComponent(tableId),
    "DELETE",
  );
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

export async function loadCatalogOutputStationsForConnection(connectionMode: ConnectionMode) {
  if (connectionMode === "LOCAL") {
    return loadCatalogOutputStations();
  }

  if (connectionMode === "RELAY") {
    const locationId = requireStaffRelayLocationId();
    const stations = await readRelayJson<CatalogOutputStation[]>(
      "/api/staff/locations/" + encodeURIComponent(locationId) + "/output-stations",
    );
    return stations.map(normalizeCatalogOutputStation);
  }

  throw new Error(describeConnectionUnavailable());
}

export async function loadOwnerCatalogForConnection(connectionMode: ConnectionMode): Promise<OwnerCatalogSnapshot> {
  if (connectionMode === "LOCAL") {
    const [products, categories, taxes, outputStations] = await Promise.all([
      loadCatalog(),
      loadCatalogCategories(),
      loadCatalogTaxes(),
      loadCatalogOutputStations(),
    ]);
    return { products, categories, taxes, output_stations: outputStations };
  }

  if (connectionMode === "RELAY") {
    const locationId = requireStaffRelayLocationId();
    const snapshot = await readRelayJson<OwnerCatalogSnapshot>(
      "/api/owner/locations/" + encodeURIComponent(locationId) + "/catalog",
    );
    return normalizeOwnerCatalogSnapshot(snapshot);
  }

  throw new Error(describeConnectionUnavailable());
}

export async function runOwnerCatalogActionForConnection(
  connectionMode: ConnectionMode,
  action: string,
  payload: unknown,
) {
  if (connectionMode === "LOCAL") {
    return runLocalOwnerCatalogAction(action, payload);
  }

  if (connectionMode === "RELAY") {
    const locationId = requireStaffRelayLocationId();
    const command = await writeRelayJson<StaffRelayCommand>(
      "/api/owner/locations/" + encodeURIComponent(locationId) + "/catalog/commands",
      "POST",
      { request_id: "owner_catalog_" + crypto.randomUUID(), action, payload },
    );
    return waitForRelayCommandAccepted(command);
  }

  throw new Error(describeConnectionUnavailable());
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

function runLocalOwnerCatalogAction(action: string, payload: unknown) {
  const input = payload as Record<string, any>;

  switch (action) {
    case "OWNER_CATALOG_PRODUCT_CREATE":
      return createCatalogProduct(input as CatalogProductInput);
    case "OWNER_CATALOG_PRODUCT_UPDATE":
      return updateCatalogProduct(String(input.product_id), input.input);
    case "OWNER_CATALOG_PRODUCT_DELETE":
      return deleteCatalogProduct(String(input.product_id));
    case "OWNER_CATALOG_PRODUCT_DUPLICATE":
      return duplicateCatalogProduct(String(input.product_id));
    case "OWNER_CATALOG_CATEGORY_CREATE":
      return createCatalogCategory(input as CatalogCategoryInput);
    case "OWNER_CATALOG_CATEGORY_UPDATE":
      return updateCatalogCategory(String(input.category_id), input.input);
    case "OWNER_CATALOG_CATEGORY_DELETE":
      return deleteCatalogCategory(String(input.category_id));
    case "OWNER_CATALOG_CATEGORY_DUPLICATE":
      return duplicateCatalogCategory(String(input.category_id));
    case "OWNER_CATALOG_TAX_CREATE":
      return createCatalogTax(input as CatalogTaxInput);
    case "OWNER_CATALOG_TAX_UPDATE":
      return updateCatalogTax(String(input.tax_id), input.input);
    case "OWNER_CATALOG_TAX_DELETE":
      return deleteCatalogTax(String(input.tax_id));
    case "OWNER_CATALOG_TAX_DUPLICATE":
      return duplicateCatalogTax(String(input.tax_id));
    default:
      throw new Error("Owner catalog action is not supported.");
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const response = await fetchLocalMaster(`${getLocalMasterUrl()}${path}`);
  return parseJsonResponse(response, fallback);
}

async function writeJson<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetchLocalMaster(`${getLocalMasterUrl()}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return parseJsonResponse(response, undefined as T);
}

async function fetchLocalMaster(input: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1_200);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readRelayJson<T>(path: string): Promise<T> {
  const response = await fetch(`${requireRelaySyncUrl()}${path}`, {
    credentials: "include",
  });
  return parseJsonResponse(response, undefined as T);
}

async function writeRelayJson<T>(path: string, method: "POST", body: unknown): Promise<T> {
  const response = await fetch(`${requireRelaySyncUrl()}${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response, undefined as T);
}

async function waitForRelayCommandAccepted(command: StaffRelayCommand): Promise<unknown> {
  let current = command;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (current.status === "accepted") {
      return current.result;
    }

    if (current.status === "failed") {
      const result = current.result as { error?: string } | null;
      throw new Error(result?.error ?? "Relay Command fehlgeschlagen.");
    }

    await new Promise((resolve) => window.setTimeout(resolve, 750));
    current = await readRelayJson<StaffRelayCommand>(current.poll_url);
  }

  throw new Error("Relay Command wartet noch auf LocalMaster.");
}

function normalizeOwnerCatalogSnapshot(snapshot: OwnerCatalogSnapshot): OwnerCatalogSnapshot {
  return {
    products: snapshot.products.map((product) => ({ ...product, isAvailable: product.is_available })),
    categories: snapshot.categories,
    taxes: snapshot.taxes,
    output_stations: snapshot.output_stations.map(normalizeCatalogOutputStation),
  };
}

function normalizeCatalogOutputStation(station: CatalogOutputStation): CatalogOutputStation {
  return {
    ...station,
    created_at: typeof station.created_at === "number" ? station.created_at : Date.parse(String(station.created_at)) || 0,
    updated_at: typeof station.updated_at === "number" ? station.updated_at : Date.parse(String(station.updated_at)) || 0,
  };
}

function requireRelaySyncUrl() {
  const relayUrl = getRelaySyncUrl();
  if (!relayUrl) {
    throw new Error("Relay URL ist nicht konfiguriert.");
  }
  return relayUrl;
}

function withOrderRequestId<T extends { request_id?: string; lines: BasketLine[]; table_context: TableContext }>(request: T): T & { request_id: string } {
  return {
    ...request,
    request_id: request.request_id || "staff_order_" + crypto.randomUUID(),
  };
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
