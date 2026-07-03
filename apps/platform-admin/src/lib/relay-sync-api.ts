export type TenantStatus = "ACTIVE" | "SUSPENDED";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
};

export type TenantInput = {
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: TenantStatus;
};

export type LocationStatus = "ACTIVE" | "SUSPENDED";
export type LocationServiceMode = "TABLE_SERVICE" | "COUNTER_SERVICE";

export type Location = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  address: string | null;
  local_master_instance_id: string | null;
  service_mode: LocationServiceMode;
  status: LocationStatus;
  created_at: string;
  updated_at: string;
};

export type LocationInput = {
  name: string;
  slug: string;
  address: string | null;
  local_master_instance_id: string | null;
  service_mode: LocationServiceMode;
  status: LocationStatus;
};

export type OutputStation = {
  id: string;
  tenant_id: string;
  location_id: string | null;
  name: string;
  has_kds: boolean;
  has_printer: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type OutputStationInput = {
  name: string;
  has_kds: boolean;
  has_printer: boolean;
  is_active: boolean;
  sort_order: number;
};

const configuredUrl = import.meta.env.VITE_RELAY_SYNC_API_URL as string | undefined;

export function getRelaySyncApiUrl() {
  return (configuredUrl || "http://localhost:3100").replace(/\/$/, "");
}

export function loadTenants() {
  return readJson<Tenant[]>("/api/admin/tenants", []);
}

export function createTenant(input: TenantInput) {
  return writeJson<Tenant>("/api/admin/tenants", "POST", input);
}

export function updateTenant(tenantId: string, input: Partial<TenantInput>) {
  return writeJson<Tenant>("/api/admin/tenants/" + encodeURIComponent(tenantId), "PATCH", input);
}

export function loadLocations(tenantId: string) {
  return readJson<Location[]>("/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations", []);
}

export function createLocation(tenantId: string, input: LocationInput) {
  return writeJson<Location>("/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations", "POST", input);
}

export function updateLocation(tenantId: string, locationId: string, input: Partial<LocationInput>) {
  return writeJson<Location>(
    "/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations/" + encodeURIComponent(locationId),
    "PATCH",
    input,
  );
}

export function loadOutputStations(tenantId: string, locationId: string) {
  return readJson<OutputStation[]>(
    "/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations/" + encodeURIComponent(locationId) + "/output-stations",
    [],
  );
}

export function createOutputStation(tenantId: string, locationId: string, input: OutputStationInput) {
  return writeJson<OutputStation>(
    "/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations/" + encodeURIComponent(locationId) + "/output-stations",
    "POST",
    input,
  );
}

export function updateOutputStation(tenantId: string, locationId: string, stationId: string, input: Partial<OutputStationInput>) {
  return writeJson<OutputStation>(
    "/api/admin/tenants/" +
      encodeURIComponent(tenantId) +
      "/locations/" +
      encodeURIComponent(locationId) +
      "/output-stations/" +
      encodeURIComponent(stationId),
    "PATCH",
    input,
  );
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const response = await fetch(`${getRelaySyncApiUrl()}${path}`);
  return parseJsonResponse(response, fallback);
}

async function writeJson<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const response = await fetch(`${getRelaySyncApiUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
