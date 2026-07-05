import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import { catalogOutputStations, localMasterCredentials, localMasterPairingSessions, locations, relayCommands, tenants } from "../db/schema.js";
import type {
  CatalogOutputStation,
  OwnerCatalogSnapshot,
  LocalMasterBootstrap,
  LocalMasterPairRequest,
  LocalMasterPairResponse,
  LocalMasterPairingSession,
  OnboardingStatus,
  RelayCommand,
  RelayCommandAckRequest
} from "../types.js";
import { ApiError } from "./errors.js";
import { listBootstrapUsers } from "./userStore.js";

const pairingTtlMs = 10 * 60 * 1000;
const relayRedeliveryTimeoutMs = Number(process.env.RELAY_COMMAND_REDELIVERY_TIMEOUT_MS ?? 30_000);

type PairingSessionRow = typeof localMasterPairingSessions.$inferSelect;
type CredentialRow = typeof localMasterCredentials.$inferSelect;
type RelayCommandRow = typeof relayCommands.$inferSelect;

export async function createLocalMasterPairingSession(tenantId: string, locationId: string): Promise<LocalMasterPairingSession> {
  await requireActiveLocation(tenantId, locationId);

  const setupCode = await createSetupCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + pairingTtlMs);
  const rows = await getDrizzleDatabase().transaction(async (tx) => {
    await tx
      .update(localMasterPairingSessions)
      .set({ expiresAt: now, updatedAt: now })
      .where(and(
        eq(localMasterPairingSessions.tenantId, tenantId),
        eq(localMasterPairingSessions.locationId, locationId),
        isNull(localMasterPairingSessions.usedAt),
        gt(localMasterPairingSessions.expiresAt, now)
      ));

    return tx
      .insert(localMasterPairingSessions)
      .values({
        id: "lm_pair_" + randomUUID(),
        tenantId,
        locationId,
        setupCodeHash: hashSecret(setupCode),
        expiresAt,
        usedAt: null,
        localMasterInstanceId: null,
        localMasterUrl: null,
        pairingResultJson: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  });

  return toPairingSession(rows[0], setupCode);
}

export async function getCurrentLocalMasterPairingSession(
  tenantId: string,
  locationId: string
): Promise<LocalMasterPairingSession> {
  await requireLocation(tenantId, locationId);
  const now = new Date();
  const rows = await getDrizzleDatabase()
    .select()
    .from(localMasterPairingSessions)
    .where(and(
      eq(localMasterPairingSessions.tenantId, tenantId),
      eq(localMasterPairingSessions.locationId, locationId),
      isNull(localMasterPairingSessions.usedAt),
      gt(localMasterPairingSessions.expiresAt, now)
    ))
    .orderBy(desc(localMasterPairingSessions.createdAt))
    .limit(1);

  if (!rows[0]) {
    return {
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
    };
  }

  return toPairingSession(rows[0], null);
}

export async function getOnboardingStatus(tenantId: string, locationId: string): Promise<OnboardingStatus> {
  await requireLocation(tenantId, locationId);
  const db = getDrizzleDatabase();
  const tenant = (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
  const location = (await db
    .select({ id: locations.id, localMasterInstanceId: locations.localMasterInstanceId })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .limit(1))[0];
  const stations = await db
    .select({ id: catalogOutputStations.id })
    .from(catalogOutputStations)
    .where(and(eq(catalogOutputStations.tenantId, tenantId), eq(catalogOutputStations.locationId, locationId)));
  const users = await listBootstrapUsers(tenantId, locationId);
  const pairingSession = await getCurrentLocalMasterPairingSession(tenantId, locationId);

  return {
    tenant_id: tenantId,
    location_id: locationId,
    tenant_ready: Boolean(tenant),
    location_ready: Boolean(location),
    output_station_count: stations.length,
    user_count: users.length,
    pairing_status: location?.localMasterInstanceId ? "PAIRED" : pairingSession.status,
    local_master_instance_id: location?.localMasterInstanceId ?? null,
  };
}

export async function pairLocalMaster(request: LocalMasterPairRequest): Promise<LocalMasterPairResponse> {
  const setupCode = normalizeSetupCode(request.setup_code);
  const instanceId = normalizeRequiredText(request.instance_id, "LocalMaster instance id is required.");
  const claimedLocationId = request.location_id?.trim() || null;
  const now = new Date();
  const db = getDrizzleDatabase();
  const sessions = await db
    .select()
    .from(localMasterPairingSessions)
    .where(eq(localMasterPairingSessions.setupCodeHash, hashSecret(setupCode)))
    .limit(1);
  const session = sessions[0];

  if (!session || session.usedAt || session.expiresAt <= now) {
    throw new ApiError("Pairing code is invalid or expired.", 400);
  }

  if (claimedLocationId && session.locationId !== claimedLocationId) {
    throw new ApiError("Pairing code does not belong to this location.", 409);
  }

  await requireActiveLocation(session.tenantId, session.locationId);
  const relayToken = "lmrt_" + randomBytes(32).toString("hex");
  const pairedAt = new Date();
  const relayBaseUrl = normalizeRelayBaseUrl();
  const pairingResult = {
    version: request.version?.trim() || null,
    paired_at: pairedAt.toISOString(),
  };

  await db.transaction(async (tx) => {
    await tx
      .update(localMasterCredentials)
      .set({ revokedAt: pairedAt, updatedAt: pairedAt })
      .where(and(
        eq(localMasterCredentials.tenantId, session.tenantId),
        eq(localMasterCredentials.locationId, session.locationId),
        isNull(localMasterCredentials.revokedAt)
      ));

    await tx
      .insert(localMasterCredentials)
      .values({
        id: "lm_cred_" + randomUUID(),
        tenantId: session.tenantId,
        locationId: session.locationId,
        localMasterInstanceId: instanceId,
        tokenDigest: hashSecret(relayToken),
        lastSeenAt: pairedAt,
        revokedAt: null,
        createdAt: pairedAt,
        updatedAt: pairedAt,
      });

    await tx
      .update(locations)
      .set({
        localMasterInstanceId: instanceId,
        updatedAt: pairedAt,
      })
      .where(and(eq(locations.tenantId, session.tenantId), eq(locations.id, session.locationId)));

    await tx
      .update(localMasterPairingSessions)
      .set({
        usedAt: pairedAt,
        localMasterInstanceId: instanceId,
        localMasterUrl: normalizeOptionalUrl(request.local_master_url),
        pairingResultJson: pairingResult,
        updatedAt: pairedAt,
      })
      .where(eq(localMasterPairingSessions.id, session.id));
  });

  return {
    tenant_id: session.tenantId,
    location_id: session.locationId,
    local_master_instance_id: instanceId,
    relay_token: relayToken,
    relay_base_url: relayBaseUrl,
    paired_at: pairedAt.toISOString(),
  };
}

export async function listPendingRelayCommands(relayToken: string): Promise<RelayCommand[]> {
  const credential = await requireLocalMasterCredential(relayToken);
  const now = new Date();
  const redeliverBefore = new Date(now.getTime() - Math.max(5_000, relayRedeliveryTimeoutMs));
  const rows = await getDrizzleDatabase()
    .update(relayCommands)
    .set({ status: "delivered", deliveredAt: now, updatedAt: now })
    .where(and(
      eq(relayCommands.tenantId, credential.tenantId),
      eq(relayCommands.locationId, credential.locationId),
      eq(relayCommands.localMasterInstanceId, credential.localMasterInstanceId),
      or(
        eq(relayCommands.status, "pending"),
        and(eq(relayCommands.status, "delivered"), lt(relayCommands.deliveredAt, redeliverBefore))
      )
    ))
    .returning();

  return rows.map(toRelayCommand);
}

export async function ackRelayCommand(
  relayToken: string,
  commandId: string,
  request: RelayCommandAckRequest
): Promise<RelayCommand> {
  const credential = await requireLocalMasterCredential(relayToken);
  const status = normalizeAckStatus(request.status);
  const now = new Date();
  const commandRow = (await getDrizzleDatabase()
    .select()
    .from(relayCommands)
    .where(and(
      eq(relayCommands.id, commandId),
      eq(relayCommands.tenantId, credential.tenantId),
      eq(relayCommands.locationId, credential.locationId),
      eq(relayCommands.localMasterInstanceId, credential.localMasterInstanceId),
      eq(relayCommands.status, "delivered")
    ))
    .limit(1))[0];

  if (!commandRow) {
    throw new ApiError("Relay command not found for this LocalMaster or not delivered.", 404);
  }

  if (status === "accepted" && commandRow.type.startsWith("OWNER_CATALOG_")) {
    const catalogSnapshot = extractCatalogSnapshot(request.result);
    if (catalogSnapshot) {
      const { replaceLocalMasterCatalog } = await import("./catalogRelayStore.js");
      await replaceLocalMasterCatalog(relayToken, catalogSnapshot);
    }
  }

  const result = status === "failed"
    ? { error: request.error ?? "Relay command failed.", result: request.result ?? null }
    : unwrapAckResult(request.result);
  const rows = await getDrizzleDatabase()
    .update(relayCommands)
    .set({
      status,
      resultJson: result,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(relayCommands.id, commandId),
      eq(relayCommands.tenantId, credential.tenantId),
      eq(relayCommands.locationId, credential.locationId),
      eq(relayCommands.localMasterInstanceId, credential.localMasterInstanceId),
      eq(relayCommands.status, "delivered")
    ))
    .returning();

  return toRelayCommand(rows[0]);
}

export async function getLocalMasterBootstrap(relayToken: string): Promise<LocalMasterBootstrap> {
  const credential = await requireLocalMasterCredential(relayToken);
  const db = getDrizzleDatabase();
  const tenant = (await db.select().from(tenants).where(eq(tenants.id, credential.tenantId)).limit(1))[0];
  const location = (await db
    .select()
    .from(locations)
    .where(and(eq(locations.tenantId, credential.tenantId), eq(locations.id, credential.locationId)))
    .limit(1))[0];

  if (!tenant || !location) {
    throw new ApiError("Bootstrap target not found.", 404);
  }

  const stations = await db
    .select()
    .from(catalogOutputStations)
    .where(and(eq(catalogOutputStations.tenantId, credential.tenantId), eq(catalogOutputStations.locationId, credential.locationId)));
  const users = await listBootstrapUsers(credential.tenantId, credential.locationId);

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      email: tenant.email,
      phone: tenant.phone,
      website: tenant.website,
      status: tenant.status,
      created_at: tenant.createdAt.toISOString(),
      updated_at: tenant.updatedAt.toISOString(),
    },
    location: {
      id: location.id,
      tenant_id: location.tenantId,
      name: location.name,
      slug: location.slug,
      address: location.address,
      local_master_instance_id: location.localMasterInstanceId,
      service_mode: location.serviceMode as "TABLE_SERVICE" | "COUNTER_SERVICE",
      status: location.status as "ACTIVE" | "SUSPENDED",
      created_at: location.createdAt.toISOString(),
      updated_at: location.updatedAt.toISOString(),
    },
    service_mode: location.serviceMode as "TABLE_SERVICE" | "COUNTER_SERVICE",
    output_stations: stations.map(toOutputStation),
    users,
    bootstrapped_at: new Date().toISOString(),
  };
}

export async function requireLocalMasterCredential(relayToken: string): Promise<CredentialRow> {
  const digest = hashSecret(relayToken);
  const rows = await getDrizzleDatabase()
    .select()
    .from(localMasterCredentials)
    .where(and(eq(localMasterCredentials.tokenDigest, digest), isNull(localMasterCredentials.revokedAt)))
    .limit(1);
  const credential = rows[0];

  if (!credential) {
    throw new ApiError("Valid LocalMaster relay token is required.", 401);
  }

  await getDrizzleDatabase()
    .update(localMasterCredentials)
    .set({ lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(localMasterCredentials.id, credential.id));

  return credential;
}

async function requireActiveLocation(tenantId: string, locationId: string) {
  const location = await requireLocation(tenantId, locationId);

  if (location.status !== "ACTIVE") {
    throw new ApiError("Location is suspended.", 409);
  }

  return location;
}

async function requireLocation(tenantId: string, locationId: string) {
  const rows = await getDrizzleDatabase()
    .select({ id: locations.id, status: locations.status })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .limit(1);

  if (!rows[0]) {
    throw new ApiError("Location not found.", 404);
  }

  const tenantRows = await getDrizzleDatabase()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenantRows[0]) {
    throw new ApiError("Tenant not found.", 404);
  }

  return rows[0];
}

async function createSetupCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const rows = await getDrizzleDatabase()
      .select({ id: localMasterPairingSessions.id })
      .from(localMasterPairingSessions)
      .where(eq(localMasterPairingSessions.setupCodeHash, hashSecret(code)))
      .limit(1);

    if (!rows[0]) {
      return code;
    }
  }

  return String(randomInt(0, 10_000_000)).padStart(7, "0");
}

function toPairingSession(row: PairingSessionRow, setupCode: string | null): LocalMasterPairingSession {
  const now = new Date();
  const status = row.usedAt ? "USED" : row.expiresAt <= now ? "EXPIRED" : "ACTIVE";

  return {
    id: row.id,
    tenant_id: row.tenantId,
    location_id: row.locationId,
    setup_code: setupCode,
    status,
    expires_at: row.expiresAt.toISOString(),
    used_at: row.usedAt?.toISOString() ?? null,
    local_master_instance_id: row.localMasterInstanceId,
    local_master_url: row.localMasterUrl,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function toRelayCommand(row: RelayCommandRow): RelayCommand {
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
  };
}

function toOutputStation(row: typeof catalogOutputStations.$inferSelect): CatalogOutputStation {
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
    updated_at: row.updatedAt.toISOString(),
  };
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSetupCode(value: string) {
  return value.replace(/\s/g, "").trim();
}

function normalizeRequiredText(value: string | undefined, message: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new ApiError(message);
  return normalized;
}

function normalizeOptionalUrl(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;

  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError("URL must use http or https.");
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeRelayBaseUrl() {
  const configured = process.env.RELAY_PUBLIC_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const port = process.env.RELAY_SYNC_API_PORT ?? "3100";
  return "http://localhost:" + port;
}

function normalizeAckStatus(value: string) {
  if (value !== "accepted" && value !== "failed") {
    throw new ApiError("Relay command ACK status must be accepted or failed.");
  }

  return value;
}

function extractCatalogSnapshot(result: unknown): OwnerCatalogSnapshot | null {
  if (!result || typeof result !== "object" || !("catalog_snapshot" in result)) {
    return null;
  }

  const snapshot = (result as { catalog_snapshot?: unknown }).catalog_snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  return snapshot as OwnerCatalogSnapshot;
}

function unwrapAckResult(result: unknown) {
  if (result && typeof result === "object" && "entity" in result) {
    return (result as { entity?: unknown }).entity ?? null;
  }

  return result ?? null;
}
