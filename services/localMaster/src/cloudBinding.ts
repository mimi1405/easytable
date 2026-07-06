import { eq } from "drizzle-orm";

import { applyBootstrapOutputStations } from "./catalogStore.js";
import { getDrizzleDatabase } from "./db/client.js";
import { localState } from "./db/schema.js";
import { getLocalMasterIdentity } from "./pairing.js";
import { setupNatsCommandSubscription } from "./lib/nats.js";
import { pushCatalogToRelay } from "./relayCatalogSync.js";
import { pushTableLayoutToRelay } from "./relayLayoutSync.js";
import { pushOperationsToRelay } from "./relayOperationsSync.js";
import { readLocalSiteConfig, saveLocalSiteConfigFromBootstrap } from "./store/localSiteStore.js";
import type { CloudBinding, CloudPairRequest, CloudPairResponse, LocalMasterBootstrap } from "./types.js";

const cloudBindingStateKey = "localMaster.cloudBinding";
const bootstrapStateKey = "localMaster.bootstrap";

type StoredCloudBinding = CloudBinding & {
  relay_token: string | null;
};

type RelayPairResponse = {
  tenant_id: string;
  location_id: string;
  local_master_instance_id: string;
  relay_token: string;
  relay_base_url: string;
  paired_at: string;
};

class CloudPairingError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function getCloudBinding(): CloudPairResponse {
  const binding = validateStoredBinding(readStoredBinding());

  return {
    ...toPublicBinding(binding),
    relay_token_present: Boolean(binding.relay_token)
  };
}

export function getRelayRuntimeBinding() {
  const binding = validateStoredBinding(readStoredBinding());
  if (binding.status !== "PAIRED" || !binding.relay_base_url || !binding.relay_token) {
    return null;
  }

  return {
    tenant_id: binding.tenant_id,
    location_id: binding.location_id,
    local_master_instance_id: binding.local_master_instance_id,
    relay_base_url: binding.relay_base_url,
    relay_token: binding.relay_token
  };
}

export async function pairCloudRelay(request: CloudPairRequest): Promise<CloudPairResponse> {
  const relayBaseUrl = normalizeUrl(request.relay_base_url);
  const identity = getLocalMasterIdentity();
  const response = await fetch(relayBaseUrl + "/api/local-masters/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      setup_code: request.setup_code,
      instance_id: identity.instance_id,
      local_master_url: normalizeOptionalUrl(request.local_master_url),
      version: identity.version
    })
  });

  if (!response.ok) {
    throw new CloudPairingError(await readRelayError(response), response.status);
  }

  const payload = (await response.json()) as RelayPairResponse;
  const now = new Date().toISOString();
  const binding: StoredCloudBinding = {
    status: "PAIRED",
    tenant_id: payload.tenant_id,
    location_id: payload.location_id,
    local_master_instance_id: payload.local_master_instance_id,
    relay_base_url: payload.relay_base_url.replace(/\/$/, ""),
    paired_at: payload.paired_at,
    last_verified_at: now,
    invalid_reason: null,
    bootstrap_completed_at: null,
    bootstrap_error: null,
    relay_token: payload.relay_token
  };

  writeStoredBinding(binding);

  await bootstrapFromRelay(binding);
  return {
    ...toPublicBinding(readStoredBinding()),
    relay_token_present: true
  };
}

export async function retryCloudBootstrap(): Promise<CloudPairResponse> {
  const binding = readStoredBinding();

  if (!binding.relay_base_url || !binding.relay_token) {
    throw new Error("LocalMaster is not paired with relay.");
  }

  await bootstrapFromRelay(binding);
  const nextBinding = readStoredBinding();

  return {
    ...toPublicBinding(nextBinding),
    relay_token_present: Boolean(nextBinding.relay_token)
  };
}

function validateStoredBinding(binding: StoredCloudBinding): StoredCloudBinding {
  if (binding.status === "UNPAIRED") {
    return binding;
  }

  const expectedLocationId = readLocalSiteConfig()?.location.id ?? null;

  if (expectedLocationId && binding.location_id && binding.location_id !== expectedLocationId) {
    return {
      ...binding,
      status: "INVALID",
      invalid_reason: "Cloud location does not match local POS settings."
    };
  }

  return binding;
}

function readStoredBinding(): StoredCloudBinding {
  const row = getDrizzleDatabase()
    .select({ valueJson: localState.valueJson })
    .from(localState)
    .where(eq(localState.key, cloudBindingStateKey))
    .get();

  if (!row) {
    return emptyBinding();
  }

  try {
    return { ...emptyBinding(), ...(JSON.parse(row.valueJson) as Partial<StoredCloudBinding>) };
  } catch {
    return {
      ...emptyBinding(),
      status: "INVALID",
      invalid_reason: "Stored cloud binding cannot be parsed."
    };
  }
}

function writeStoredBinding(binding: StoredCloudBinding) {
  getDrizzleDatabase()
    .insert(localState)
    .values({ key: cloudBindingStateKey, valueJson: JSON.stringify(binding), updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: localState.key,
      set: { valueJson: JSON.stringify(binding), updatedAt: Date.now() }
    })
    .run();
}

async function bootstrapFromRelay(binding: StoredCloudBinding) {
  if (!binding.relay_base_url || !binding.relay_token) {
    return;
  }

  const now = new Date().toISOString();

  try {
    const response = await fetch(binding.relay_base_url + "/api/local-masters/bootstrap", {
      headers: { Authorization: "Bearer " + binding.relay_token }
    });

    if (!response.ok) {
      throw new Error(await readRelayError(response));
    }

    const bootstrap = (await response.json()) as LocalMasterBootstrap;
    const expectedLocationId = binding.location_id;

    if (expectedLocationId && bootstrap.location.id !== expectedLocationId) {
      throw new Error("Bootstrap location does not match cloud binding.");
    }

    writeLocalState(bootstrapStateKey, bootstrap);
    saveLocalSiteConfigFromBootstrap(bootstrap);
    applyBootstrapOutputStations(bootstrap.output_stations);
    writeStoredBinding({
      ...binding,
      status: "PAIRED",
      bootstrap_completed_at: bootstrap.bootstrapped_at,
      bootstrap_error: null,
      last_verified_at: now
    });
    void pushTableLayoutToRelay(binding);
    void pushCatalogToRelay(binding);
    void pushOperationsToRelay(binding);
    void setupNatsCommandSubscription();
  } catch (error) {
    writeStoredBinding({
      ...binding,
      status: "PAIRED_BOOTSTRAP_FAILED",
      bootstrap_error: error instanceof Error ? error.message : String(error),
      last_verified_at: now
    });
  }
}

function writeLocalState(key: string, value: unknown) {
  getDrizzleDatabase()
    .insert(localState)
    .values({ key, valueJson: JSON.stringify(value), updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: localState.key,
      set: { valueJson: JSON.stringify(value), updatedAt: Date.now() }
    })
    .run();
}

function emptyBinding(): StoredCloudBinding {
  return {
    status: "UNPAIRED",
    tenant_id: null,
    location_id: null,
    local_master_instance_id: null,
    relay_base_url: null,
    paired_at: null,
    last_verified_at: null,
    invalid_reason: null,
    bootstrap_completed_at: null,
    bootstrap_error: null,
    relay_token: null
  };
}

function toPublicBinding(binding: StoredCloudBinding): CloudBinding {
  return {
    status: binding.status,
    tenant_id: binding.tenant_id,
    location_id: binding.location_id,
    local_master_instance_id: binding.local_master_instance_id,
    relay_base_url: binding.relay_base_url,
    paired_at: binding.paired_at,
    last_verified_at: binding.last_verified_at,
    invalid_reason: binding.invalid_reason,
    bootstrap_completed_at: binding.bootstrap_completed_at,
    bootstrap_error: binding.bootstrap_error
  };
}

function normalizeOptionalUrl(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalizeUrl(normalized) : null;
}

function normalizeUrl(value: string) {
  const parsed = new URL(value.trim());

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Relay URL must use http or https.");
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString().replace(/\/$/, "");
}

async function readRelayError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? "Relay pairing failed.";
  } catch {
    return (await response.text().catch(() => "")) || "Relay pairing failed.";
  }
}
