import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";

import { getDrizzleDatabase } from "./db/client.js";
import { localState, pairedTerminals } from "./db/schema.js";
import type { BootstrapUser } from "./types.js";

const bootstrapKey = "localMaster.bootstrap";
const sessionsKey = "localAuth.sessions";
const attemptsKey = "localAuth.attempts";
const sessionTtlMs = 12 * 60 * 60 * 1000;
const attemptWindowMs = 5 * 60 * 1000;
const deviceValidityMs = 30 * 24 * 60 * 60 * 1000;

type LocalSession = {
  token: string;
  user_id: string;
  email: string;
  display_name: string;
  role: BootstrapUser["role"];
  device_id: string;
  expires_at: number;
};

export function loginWithLocalPin(request: { device_id: string; device_secret: string; user_id: string; pin: string }) {
  const device = requireSalesDevice(request.device_id, request.device_secret);
  assertAttemptAllowed(device.id, request.user_id);

  const user = loadBootstrapUsers().find((candidate) => candidate.user_id === request.user_id);
  if (!user || user.status !== "ACTIVE" || !user.is_active || !user.pin_hash || !verifyPin(request.pin, user.pin_hash)) {
    recordFailedAttempt(device.id, request.user_id);
    throw unauthorized("PIN or local user is invalid.");
  }
  clearAttempts(device.id, request.user_id);

  const session: LocalSession = {
    token: "lms_" + randomBytes(32).toString("hex"),
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    device_id: device.id,
    expires_at: Date.now() + sessionTtlMs,
  };
  const sessions = loadSessions().filter((candidate) => candidate.expires_at > Date.now() && candidate.device_id !== device.id);
  sessions.push(session);
  writeState(sessionsKey, sessions);
  return session;
}

export function requireLocalSession(authorization?: string) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const session = loadSessions().find((candidate) => safeEqual(candidate.token, token) && candidate.expires_at > Date.now());
  if (!session) throw unauthorized("Valid local Staff session is required.");
  return session;
}

export function listLocalLoginUsers() {
  return loadBootstrapUsers()
    .filter((user) => user.status === "ACTIVE" && user.is_active && user.pin_hash)
    .map(({ user_id, display_name, role }) => ({ user_id, display_name, role }));
}

export function requireStaffDevice(deviceId?: string, deviceSecret?: string) {
  const device = requireSalesDevice(deviceId, deviceSecret);
  if (device.role !== "STAFF_DEVICE") throw unauthorized("Staff device is not authorized.");
  return device;
}

export function requireSalesDevice(deviceId?: string, deviceSecret?: string) {
  const device = deviceId ? getDrizzleDatabase().select().from(pairedTerminals).where(eq(pairedTerminals.id, deviceId)).get() : null;
  if (!device || !["STAFF_DEVICE", "POS_TERMINAL", "MASTER_POS"].includes(device.role) || !deviceSecret || !safeEqual(device.secret, deviceSecret)) {
    throw unauthorized("Sales device is not authorized.");
  }
  if (Date.now() - device.pairedAt > deviceValidityMs) throw unauthorized("Sales device authorization must be renewed online.");
  return device;
}

function loadBootstrapUsers(): BootstrapUser[] {
  const value = readState<{ users?: BootstrapUser[] }>(bootstrapKey);
  return value?.users ?? [];
}

function loadSessions() {
  return readState<LocalSession[]>(sessionsKey) ?? [];
}

function verifyPin(pin: string, encoded: string) {
  const [algorithm, iterationsText, salt, expectedHex] = encoded.split("$");
  if (algorithm !== "pbkdf2_sha256" || !iterationsText || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = pbkdf2Sync(pin, salt, Number(iterationsText), expected.length, "sha256");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function assertAttemptAllowed(deviceId: string, userId: string) {
  const cutoff = Date.now() - attemptWindowMs;
  const attempts = (readState<Record<string, number[]>>(attemptsKey) ?? {})[deviceId + ":" + userId] ?? [];
  if (attempts.filter((timestamp) => timestamp >= cutoff).length >= 5) throw unauthorized("Too many PIN attempts. Try again later.", 429);
}

function recordFailedAttempt(deviceId: string, userId: string) {
  const attempts = readState<Record<string, number[]>>(attemptsKey) ?? {};
  const key = deviceId + ":" + userId;
  attempts[key] = [...(attempts[key] ?? []).filter((timestamp) => timestamp >= Date.now() - attemptWindowMs), Date.now()];
  writeState(attemptsKey, attempts);
}

function clearAttempts(deviceId: string, userId: string) {
  const attempts = readState<Record<string, number[]>>(attemptsKey) ?? {};
  delete attempts[deviceId + ":" + userId];
  writeState(attemptsKey, attempts);
}

function unauthorized(message: string, statusCode = 401) {
  return Object.assign(new Error(message), { statusCode });
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readState<T>(key: string): T | null {
  const row = getDrizzleDatabase().select({ valueJson: localState.valueJson }).from(localState).where(eq(localState.key, key)).get();
  if (!row) return null;
  try { return JSON.parse(row.valueJson) as T; } catch { return null; }
}

function writeState(key: string, value: unknown) {
  const valueJson = JSON.stringify(value);
  getDrizzleDatabase().insert(localState).values({ key, valueJson, updatedAt: Date.now() }).onConflictDoUpdate({
    target: localState.key,
    set: { valueJson, updatedAt: Date.now() },
  }).run();
}
