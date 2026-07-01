import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { getDrizzleDatabase } from "./db/client.js";
import { localState, pairedTerminals, pairingSessions } from "./db/schema.js";
import { loadPosSettings } from "./store.js";
import type {
  LocalMasterIdentity,
  PairTerminalRequest,
  PairingSession,
  PairingSessionRequest,
  TerminalHeartbeatRequest,
  TerminalPairingConfig,
  TerminalRecord
} from "./types.js";

const instanceStateKey = "localMaster.instanceId";
const pairingTtlMs = 5 * 60 * 1000;

export function getLocalMasterIdentity(): LocalMasterIdentity {
  const settings = loadPosSettings().settings;

  return {
    ok: true,
    service: "localMaster",
    instance_id: getOrCreateInstanceId(),
    location_id: settings.location_id,
    port: Number(process.env.LOCAL_MASTER_PORT ?? process.env.LOCAL_REALTIME_PORT ?? 3000),
    version: process.env.npm_package_version ?? "0.1.0"
  };
}

export function createPairingSession(request: PairingSessionRequest = {}): PairingSession {
  const now = Date.now();
  const session: PairingSession = {
    code: createPairingCode(),
    expires_at: now + pairingTtlMs,
    instance_id: getOrCreateInstanceId(),
    local_master_url: normalizeOptionalUrl(request.local_master_url),
    location_id: loadPosSettings().settings.location_id
  };

  getDrizzleDatabase()
    .insert(pairingSessions)
    .values({
      code: session.code,
      instanceId: session.instance_id,
      displayUrl: session.local_master_url,
      expiresAt: session.expires_at,
      usedAt: null,
      createdAt: now
    })
    .run();

  return session;
}

export function pairTerminal(request: PairTerminalRequest): TerminalPairingConfig {
  const terminalName = request.terminal_name.trim();
  const code = normalizePairingCode(request.code);
  const localMasterUrl = normalizeUrl(request.local_master_url);

  if (terminalName.length === 0) {
    throw new Error("Terminal name is required.");
  }

  const db = getDrizzleDatabase();
  const now = Date.now();
  const session = db.select().from(pairingSessions).where(eq(pairingSessions.code, code)).get();

  if (!session || session.usedAt !== null || session.expiresAt < now) {
    throw new Error("Pairing code is invalid or expired.");
  }

  const terminalId = "term_" + randomUUID();
  const terminalSecret = randomBytes(24).toString("hex");
  const role = request.role ?? "POS_TERMINAL";

  db.insert(pairedTerminals)
    .values({
      id: terminalId,
      instanceId: session.instanceId,
      name: terminalName,
      role,
      secret: terminalSecret,
      deviceFingerprint: request.device_fingerprint ?? null,
      pairedAt: now,
      lastSeenAt: now
    })
    .run();
  db.update(pairingSessions).set({ usedAt: now }).where(eq(pairingSessions.code, code)).run();

  return {
    localMasterUrl,
    localMasterInstanceId: session.instanceId,
    terminalId,
    terminalName,
    terminalRole: role,
    terminalSecret,
    pairedAt: now,
    lastSeenAt: now
  };
}

export function recordTerminalHeartbeat(
  terminalId: string,
  request: TerminalHeartbeatRequest
): TerminalRecord {
  const db = getDrizzleDatabase();
  const terminal = db.select().from(pairedTerminals).where(eq(pairedTerminals.id, terminalId)).get();

  if (!terminal || terminal.secret !== request.terminal_secret) {
    throw new Error("Unknown terminal or invalid terminal secret.");
  }

  const now = Date.now();
  db.update(pairedTerminals).set({ lastSeenAt: now }).where(eq(pairedTerminals.id, terminalId)).run();

  return {
    id: terminal.id,
    instance_id: terminal.instanceId,
    name: terminal.name,
    role: terminal.role,
    device_fingerprint: terminal.deviceFingerprint,
    paired_at: terminal.pairedAt,
    last_seen_at: now
  };
}

function getOrCreateInstanceId() {
  const db = getDrizzleDatabase();
  const row = db
    .select({ valueJson: localState.valueJson })
    .from(localState)
    .where(eq(localState.key, instanceStateKey))
    .get();

  if (row) {
    return JSON.parse(row.valueJson) as string;
  }

  const instanceId = "lm_" + randomUUID();
  db.insert(localState)
    .values({ key: instanceStateKey, valueJson: JSON.stringify(instanceId), updatedAt: Date.now() })
    .run();

  return instanceId;
}

function createPairingCode() {
  const db = getDrizzleDatabase();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const existing = db
      .select({ code: pairingSessions.code })
      .from(pairingSessions)
      .where(and(eq(pairingSessions.code, code), isNull(pairingSessions.usedAt)))
      .get();

    if (!existing) {
      return code;
    }
  }

  return String(randomInt(0, 10_000_000)).padStart(7, "0");
}

function normalizePairingCode(code: string) {
  return code.replace(/\s/g, "").trim();
}

function normalizeOptionalUrl(url: string | undefined) {
  if (!url || url.trim().length === 0) {
    return null;
  }

  return normalizeUrl(url);
}

function normalizeUrl(url: string) {
  const parsed = new URL(url.trim());

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("LocalMaster URL must use http or https.");
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString().replace(/\/$/, "");
}
