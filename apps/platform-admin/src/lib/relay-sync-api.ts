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
  local_master_instance_id?: string | null;
  service_mode: LocationServiceMode;
  status: LocationStatus;
};

export type LocalMasterPairingSessionStatus = "ACTIVE" | "USED" | "EXPIRED" | "NONE";

export type LocalMasterPairingSession = {
  id: string;
  tenant_id: string;
  location_id: string;
  setup_code: string | null;
  status: LocalMasterPairingSessionStatus;
  expires_at: string | null;
  used_at: string | null;
  local_master_instance_id: string | null;
  local_master_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type TenantUserRole = "OWNER" | "MANAGER" | "STAFF" | "KDS" | "POS_OPERATOR";

export type TenantLocationUser = {
  user_id: string;
  tenant_id: string;
  location_id: string;
  email: string;
  display_name: string;
  role: TenantUserRole;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  has_password: boolean;
  has_pin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TenantLocationUserInput = {
  email: string;
  display_name: string;
  role: TenantUserRole;
  password?: string | null;
  pin?: string | null;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  is_active: boolean;
};

export type TenantLocationUserResetPasswordInput = {
  password?: string | null;
  send_email?: boolean;
};

export type TenantLocationUserResetPasswordResult = {
  user: TenantLocationUser;
  email_sent: boolean;
};

export type TenantLocationUserResetPinInput = {
  pin?: string | null;
};

export type TenantLocationUserResetPinResult = {
  user: TenantLocationUser;
  generated_pin?: string;
};

export type PlatformAdministrator = {
  user_id: string;
  email: string;
  display_name: string;
  role: "platform_admin";
  status: "ACTIVE" | "INVITED" | "DISABLED";
  created_at: string;
  updated_at: string;
};

export type PlatformAdministratorInput = {
  email: string;
  display_name: string;
  status: PlatformAdministrator["status"];
};

export type PlatformAdministratorUpdateInput = {
  display_name?: string;
  status?: PlatformAdministrator["status"];
};

export type PlatformAdministratorMutationResult = {
  user: PlatformAdministrator;
  email_sent: boolean;
};

export type AccountSetupContext = {
  email: string;
  display_name: string;
  kind: "platform_admin" | "location_user";
  requires_pin: boolean;
  tenant_id: string | null;
  location_id: string | null;
};

export type AccountSetupCompleteInput = {
  password: string;
  pin?: string | null;
};

export type AccountSetupCompleteResult = {
  ok: true;
  kind: AccountSetupContext["kind"];
};

export type OnboardingStatus = {
  tenant_id: string;
  location_id: string;
  tenant_ready: boolean;
  location_ready: boolean;
  output_station_count: number;
  user_count: number;
  pairing_status: LocalMasterPairingSessionStatus | "PAIRED";
  local_master_instance_id: string | null;
};

export type OutputStation = {
  id: string;
  tenant_id: string;
  location_id: string | null;
  name: string;
  kind?: string;
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

export function loadPlatformAdministrators() {
  return readJson<PlatformAdministrator[]>("/api/admin/platform-administrators", []);
}

export function createPlatformAdministrator(input: PlatformAdministratorInput) {
  return writeJson<PlatformAdministratorMutationResult>("/api/admin/platform-administrators", "POST", input);
}

export function updatePlatformAdministrator(userId: string, input: PlatformAdministratorUpdateInput) {
  return writeJson<PlatformAdministrator>(
    "/api/admin/platform-administrators/" + encodeURIComponent(userId),
    "PATCH",
    input,
  );
}

export function resetPlatformAdministratorPassword(userId: string) {
  return writeJson<PlatformAdministratorMutationResult>(
    "/api/admin/platform-administrators/" + encodeURIComponent(userId) + "/reset-password",
    "POST",
    {},
  );
}

export function archivePlatformAdministrator(userId: string) {
  return writeJson<PlatformAdministrator>(
    "/api/admin/platform-administrators/" + encodeURIComponent(userId) + "/archive",
    "POST",
    {},
  );
}

export function deletePlatformAdministrator(userId: string) {
  return writeJson<void>(
    "/api/admin/platform-administrators/" + encodeURIComponent(userId),
    "DELETE",
    undefined,
  );
}

export function loadAccountSetupContext(token: string) {
  return readJson<AccountSetupContext>("/api/auth/account-setup/" + encodeURIComponent(token), {
    email: "",
    display_name: "",
    kind: "location_user",
    requires_pin: true,
    tenant_id: null,
    location_id: null,
  });
}

export function completeAccountSetup(token: string, input: AccountSetupCompleteInput) {
  return writeJson<AccountSetupCompleteResult>("/api/auth/account-setup/" + encodeURIComponent(token), "POST", input);
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

export function createLocalMasterPairingSession(tenantId: string, locationId: string) {
  return writeJson<LocalMasterPairingSession>(
    "/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations/" + encodeURIComponent(locationId) + "/pairing-sessions",
    "POST",
    {},
  );
}

export function loadCurrentLocalMasterPairingSession(tenantId: string, locationId: string) {
  return readJson<LocalMasterPairingSession>(
    "/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations/" + encodeURIComponent(locationId) + "/pairing-sessions/current",
    {
      id: "",
      tenant_id: tenantId,
      location_id: locationId,
      setup_code: null,
      status: "NONE",
      expires_at: null,
      used_at: null,
      local_master_instance_id: null,
      local_master_url: null,
      created_at: null,
      updated_at: null,
    },
  );
}

export function loadOnboardingStatus(tenantId: string, locationId: string) {
  return readJson<OnboardingStatus>(
    "/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations/" + encodeURIComponent(locationId) + "/onboarding-status",
    {
      tenant_id: tenantId,
      location_id: locationId,
      tenant_ready: false,
      location_ready: false,
      output_station_count: 0,
      user_count: 0,
      pairing_status: "NONE",
      local_master_instance_id: null,
    },
  );
}

export function loadOutputStations(tenantId: string, locationId: string) {
  return readJson<OutputStation[]>(
    "/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations/" + encodeURIComponent(locationId) + "/output-stations",
    [],
  );
}

export function loadLocationUsers(tenantId: string, locationId: string) {
  return readJson<TenantLocationUser[]>(
    "/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations/" + encodeURIComponent(locationId) + "/users",
    [],
  );
}

export function createLocationUser(tenantId: string, locationId: string, input: TenantLocationUserInput) {
  return writeJson<TenantLocationUser>(
    "/api/admin/tenants/" + encodeURIComponent(tenantId) + "/locations/" + encodeURIComponent(locationId) + "/users",
    "POST",
    input,
  );
}

export function updateLocationUser(tenantId: string, locationId: string, userId: string, input: Partial<TenantLocationUserInput>) {
  return writeJson<TenantLocationUser>(
    "/api/admin/tenants/" +
      encodeURIComponent(tenantId) +
      "/locations/" +
      encodeURIComponent(locationId) +
      "/users/" +
      encodeURIComponent(userId),
    "PATCH",
    input,
  );
}

export function resetLocationUserPassword(
  tenantId: string,
  locationId: string,
  userId: string,
  input: TenantLocationUserResetPasswordInput = {},
) {
  return writeJson<TenantLocationUserResetPasswordResult>(
    "/api/admin/tenants/" +
      encodeURIComponent(tenantId) +
      "/locations/" +
      encodeURIComponent(locationId) +
      "/users/" +
      encodeURIComponent(userId) +
      "/reset-password",
    "POST",
    input,
  );
}

export function resetLocationUserPin(
  tenantId: string,
  locationId: string,
  userId: string,
  input: TenantLocationUserResetPinInput = {},
) {
  return writeJson<TenantLocationUserResetPinResult>(
    "/api/admin/tenants/" +
      encodeURIComponent(tenantId) +
      "/locations/" +
      encodeURIComponent(locationId) +
      "/users/" +
      encodeURIComponent(userId) +
      "/reset-pin",
    "POST",
    input,
  );
}

export function archiveLocationUser(tenantId: string, locationId: string, userId: string) {
  return writeJson<TenantLocationUser>(
    "/api/admin/tenants/" +
      encodeURIComponent(tenantId) +
      "/locations/" +
      encodeURIComponent(locationId) +
      "/users/" +
      encodeURIComponent(userId) +
      "/archive",
    "POST",
    {},
  );
}

export function deleteLocationUser(tenantId: string, locationId: string, userId: string) {
  return writeJson<void>(
    "/api/admin/tenants/" +
      encodeURIComponent(tenantId) +
      "/locations/" +
      encodeURIComponent(locationId) +
      "/users/" +
      encodeURIComponent(userId),
    "DELETE",
    undefined,
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

export async function deleteOutputStation(tenantId: string, locationId: string, stationId: string): Promise<void> {
  const response = await fetch(
    `${getRelaySyncApiUrl()}/api/admin/tenants/${encodeURIComponent(tenantId)}/locations/${encodeURIComponent(locationId)}/output-stations/${encodeURIComponent(stationId)}`,
    {
      method: "DELETE",
      headers: createHeaders(),
      credentials: "include",
    }
  );
  await parseJsonResponse(response, undefined);
}


async function readJson<T>(path: string, fallback: T): Promise<T> {
  const response = await fetch(`${getRelaySyncApiUrl()}${path}`, {
    headers: createHeaders(),
    credentials: "include",
  });
  return parseJsonResponse(response, fallback);
}

async function writeJson<T>(path: string, method: "POST" | "PATCH" | "DELETE", body: unknown): Promise<T> {
  const response = await fetch(`${getRelaySyncApiUrl()}${path}`, {
    method,
    headers: body === undefined ? createHeaders() : createHeaders({ "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
  });

  return parseJsonResponse(response, undefined as T);
}

function createHeaders(extra: Record<string, string> = {}) {
  return { ...extra };
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
