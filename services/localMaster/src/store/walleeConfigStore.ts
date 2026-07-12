import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type { getRelayRuntimeBinding } from "../cloudBinding.js";
import { getDrizzleDatabase } from "../db/client.js";
import { localWalleeConfig, localWalleeConfigAudit, localWalleeTerminals } from "../db/schema.js";
import { getLocalMasterIdentity } from "../pairing.js";
import { WalleeClient, type WalleeCredentials } from "./walleeClient.js";

export type RelayWalleeConfigPayload = {
  config_version: number;
  checksum: string;
  tenant_id: string;
  location_id: string;
  local_master_instance_id: string;
  wallee: {
    enabled: boolean;
    mode: "CLOUD_TILL_LONG_POLLING";
    profile_id: string;
    space_id: string;
    application_user_id: string;
    authentication_key: string;
    confirmation_policy: "EXPLICIT";
    receipt_policy: "FETCH_AND_QUEUE_UNPRINTED";
    terminals: Array<{
      id: string;
      display_name: string;
      terminal_id: string | null;
      terminal_identifier: string | null;
      is_default: boolean;
      is_active: boolean;
    }>;
  } | null;
};

export type ActiveWalleeConfig = {
  id: string;
  configVersion: number;
  profileId: string;
  credentials: WalleeCredentials;
  confirmationPolicy: "EXPLICIT";
  receiptPolicy: "FETCH_AND_QUEUE_UNPRINTED";
  terminals: Array<{
    configId: string;
    displayName: string;
    terminalId: string | null;
    terminalIdentifier: string | null;
    isDefault: boolean;
    isActive: boolean;
  }>;
};

export async function pullAndActivateWalleeConfig(
  binding: NonNullable<ReturnType<typeof getRelayRuntimeBinding>>,
  expectedVersion?: number,
  expectedChecksum?: string
) {
  assertRelayTransport(binding.relay_base_url);
  const response = await fetch(binding.relay_base_url + "/api/local-masters/payment-config", {
    headers: { Authorization: "Bearer " + binding.relay_token }
  });
  if (!response.ok) throw new Error("Wallee configuration download failed with HTTP " + response.status + ".");
  const payload = (await response.json()) as RelayWalleeConfigPayload;
  validateBinding(payload, binding);
  if (expectedVersion !== undefined && payload.config_version < expectedVersion) {
    throw new Error("Relay returned an older Wallee configuration version than announced.");
  }
  if (expectedChecksum !== undefined && payload.checksum !== expectedChecksum) {
    throw new Error("Relay returned a Wallee configuration with an unexpected checksum.");
  }

  const latest = getLatestWalleeConfigRow();
  if (latest && (payload.config_version < latest.configVersion || (payload.config_version === latest.configVersion && latest.status !== "rejected"))) {
    return getWalleeConfigStatus();
  }

  if (!payload.wallee?.enabled) {
    disableActiveWalleeConfig(payload);
    return getWalleeConfigStatus();
  }

  const encryptedKey = encryptSecret(payload.wallee.authentication_key);
  const now = Date.now();
  const retryRejected = latest?.configVersion === payload.config_version && latest.status === "rejected";
  const configId = retryRejected ? latest.id : "local_wallee_" + randomUUID();
  const db = getDrizzleDatabase();

  db.transaction((tx) => {
    const configValues = {
      id: configId,
      tenantId: payload.tenant_id,
      locationId: payload.location_id,
      localMasterInstanceId: payload.local_master_instance_id,
      relayProfileId: payload.wallee!.profile_id,
      configVersion: payload.config_version,
      spaceId: payload.wallee!.space_id,
      applicationUserId: payload.wallee!.application_user_id,
      authenticationKeyEncrypted: encryptedKey,
      confirmationPolicy: payload.wallee!.confirmation_policy,
      receiptPolicy: payload.wallee!.receipt_policy,
      status: "pending",
      checksum: payload.checksum,
      validationError: null,
      activatedAt: null,
      createdAt: now,
      updatedAt: now
    };
    if (retryRejected) {
      tx.delete(localWalleeTerminals).where(eq(localWalleeTerminals.configId, configId)).run();
      tx.update(localWalleeConfig).set({ ...configValues, id: undefined, createdAt: latest.createdAt }).where(eq(localWalleeConfig.id, configId)).run();
    } else {
      tx.insert(localWalleeConfig).values(configValues).run();
    }
    for (const terminal of payload.wallee!.terminals) {
      tx.insert(localWalleeTerminals).values({
        id: "local_wallee_terminal_" + randomUUID(),
        configId,
        relayTerminalId: terminal.id,
        displayName: terminal.display_name,
        terminalId: terminal.terminal_id,
        terminalIdentifier: terminal.terminal_identifier,
        isDefault: terminal.is_default ? 1 : 0,
        isActive: terminal.is_active ? 1 : 0,
        createdAt: now,
        updatedAt: now
      }).run();
    }
  });

  try {
    await validatePendingConfig(configId, payload.wallee.authentication_key);
    db.transaction((tx) => {
      tx.update(localWalleeConfig).set({ status: "superseded", updatedAt: Date.now() }).where(eq(localWalleeConfig.status, "active")).run();
      tx.update(localWalleeConfig).set({ status: "active", activatedAt: Date.now(), updatedAt: Date.now() }).where(eq(localWalleeConfig.id, configId)).run();
      insertAudit(tx, payload.config_version, "ACTIVATE", "accepted", payload.checksum, null);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.update(localWalleeConfig).set({ status: "rejected", validationError: message, updatedAt: Date.now() }).where(eq(localWalleeConfig.id, configId)).run();
    db.insert(localWalleeConfigAudit).values({
      id: "local_wallee_audit_" + randomUUID(),
      configVersion: payload.config_version,
      action: "VALIDATE",
      status: "failed",
      checksum: payload.checksum,
      error: message,
      createdAt: Date.now()
    }).run();
    throw new Error("Wallee configuration validation failed: " + message);
  }

  return getWalleeConfigStatus();
}

export function getActiveWalleeConfig(): ActiveWalleeConfig {
  const row = getActiveWalleeConfigRow();
  if (!row) throw new Error("No active local Wallee configuration is available.");
  const terminals = getDrizzleDatabase().select().from(localWalleeTerminals).where(eq(localWalleeTerminals.configId, row.id)).all();
  return {
    id: row.id,
    configVersion: row.configVersion,
    profileId: row.relayProfileId,
    credentials: {
      spaceId: row.spaceId,
      applicationUserId: row.applicationUserId,
      authenticationKey: decryptSecret(row.authenticationKeyEncrypted)
    },
    confirmationPolicy: row.confirmationPolicy as "EXPLICIT",
    receiptPolicy: row.receiptPolicy as "FETCH_AND_QUEUE_UNPRINTED",
    terminals: terminals.map((terminal) => ({
      configId: terminal.relayTerminalId,
      displayName: terminal.displayName,
      terminalId: terminal.terminalId,
      terminalIdentifier: terminal.terminalIdentifier,
      isDefault: terminal.isDefault === 1,
      isActive: terminal.isActive === 1
    }))
  };
}

export function selectActiveWalleeTerminal(configId?: string) {
  const config = getActiveWalleeConfig();
  const active = config.terminals.filter((terminal) => terminal.isActive);
  const terminal = configId
    ? active.find((candidate) => candidate.configId === configId)
    : active.find((candidate) => candidate.isDefault) ?? active[0];
  if (!terminal) throw new Error(configId ? "Configured Wallee terminal is unknown or inactive." : "No active Wallee terminal is configured.");
  return { config, terminal };
}

export function getWalleeConfigStatus() {
  const active = getActiveWalleeConfigRow();
  const latest = getLatestWalleeConfigRow();
  let credentialError: string | null = null;
  if (active) {
    try {
      decryptSecret(active.authenticationKeyEncrypted);
    } catch (error) {
      credentialError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    enabled: Boolean(active) && credentialError === null,
    active_config_version: active?.configVersion ?? null,
    latest_config_version: latest?.configVersion ?? null,
    latest_status: latest?.status ?? "unconfigured",
    validation_error: credentialError ?? latest?.validationError ?? null,
    credential_key_available: Boolean(process.env.LOCAL_MASTER_WALLEE_ENCRYPTION_KEY?.trim())
  };
}

function getActiveWalleeConfigRow() {
  return getDrizzleDatabase().select().from(localWalleeConfig).where(eq(localWalleeConfig.status, "active")).orderBy(desc(localWalleeConfig.configVersion)).limit(1).get();
}

function getLatestWalleeConfigRow() {
  return getDrizzleDatabase().select().from(localWalleeConfig).orderBy(desc(localWalleeConfig.configVersion)).limit(1).get();
}

async function validatePendingConfig(configId: string, authenticationKey: string) {
  const config = getDrizzleDatabase().select().from(localWalleeConfig).where(eq(localWalleeConfig.id, configId)).get();
  if (!config) throw new Error("Pending Wallee configuration is missing.");
  const terminals = getDrizzleDatabase().select().from(localWalleeTerminals).where(and(eq(localWalleeTerminals.configId, configId), eq(localWalleeTerminals.isActive, 1))).all();
  if (terminals.length === 0) throw new Error("At least one active Wallee terminal is required.");
  if (terminals.filter((terminal) => terminal.isDefault === 1).length !== 1) throw new Error("Exactly one active default Wallee terminal is required.");
  const client = new WalleeClient({ spaceId: config.spaceId, applicationUserId: config.applicationUserId, authenticationKey });
  for (const terminal of terminals) {
    if (!terminal.terminalId && !terminal.terminalIdentifier) throw new Error("Wallee terminal id or identifier is required.");
    const resolved = await client.resolveTerminal({ terminalId: terminal.terminalId, terminalIdentifier: terminal.terminalIdentifier });
    const resolvedId = String(resolved.id);
    if (terminal.terminalId !== resolvedId) {
      getDrizzleDatabase().update(localWalleeTerminals).set({ terminalId: resolvedId, updatedAt: Date.now() }).where(eq(localWalleeTerminals.id, terminal.id)).run();
    }
  }
}

function disableActiveWalleeConfig(payload: RelayWalleeConfigPayload) {
  const db = getDrizzleDatabase();
  const active = getActiveWalleeConfigRow();
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(localWalleeConfig).set({ status: "superseded", updatedAt: now }).where(eq(localWalleeConfig.status, "active")).run();
    tx.insert(localWalleeConfig).values({
      id: "local_wallee_" + randomUUID(),
      tenantId: payload.tenant_id,
      locationId: payload.location_id,
      localMasterInstanceId: payload.local_master_instance_id,
      relayProfileId: active?.relayProfileId ?? "disabled",
      configVersion: payload.config_version,
      spaceId: active?.spaceId ?? "",
      applicationUserId: active?.applicationUserId ?? "",
      authenticationKeyEncrypted: active?.authenticationKeyEncrypted ?? "disabled",
      confirmationPolicy: active?.confirmationPolicy ?? "EXPLICIT",
      receiptPolicy: active?.receiptPolicy ?? "FETCH_AND_QUEUE_UNPRINTED",
      status: "disabled",
      checksum: payload.checksum,
      validationError: null,
      activatedAt: now,
      createdAt: now,
      updatedAt: now
    }).run();
    insertAudit(tx, payload.config_version, "DISABLE", "accepted", payload.checksum, null);
  });
}

function validateBinding(payload: RelayWalleeConfigPayload, binding: NonNullable<ReturnType<typeof getRelayRuntimeBinding>>) {
  const identity = getLocalMasterIdentity();
  if (payload.tenant_id !== binding.tenant_id || payload.location_id !== binding.location_id || payload.local_master_instance_id !== identity.instance_id) {
    throw new Error("Wallee configuration does not belong to this LocalMaster binding.");
  }
}

function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptSecret(value: string) {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Stored Wallee authentication key is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function encryptionKey() {
  const value = process.env.LOCAL_MASTER_WALLEE_ENCRYPTION_KEY?.trim();
  if (!value) throw new Error("LOCAL_MASTER_WALLEE_ENCRYPTION_KEY is required for Wallee payments.");
  return createHash("sha256").update(value).digest();
}

function assertRelayTransport(baseUrl: string) {
  const url = new URL(baseUrl);
  const localDevelopmentHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !localDevelopmentHost) {
    throw new Error("Relay payment configuration must be downloaded over HTTPS in production.");
  }
}

function insertAudit(tx: any, version: number, action: string, status: string, checksum: string, error: string | null) {
  tx.insert(localWalleeConfigAudit).values({
    id: "local_wallee_audit_" + randomUUID(),
    configVersion: version,
    action,
    status,
    checksum,
    error,
    createdAt: Date.now()
  }).run();
}
