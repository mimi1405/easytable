import { createHash } from "node:crypto";

import { readState, writeState } from "../statePersistence.js";
import { scopedId } from "./storeHelpers.js";

export type CommandStatus = "IN_PROGRESS" | "COMPLETED" | "FAILED";

export type CommandInboxEntry = {
  id: string;
  command_type: string;
  request_id: string;
  payload_fingerprint: string;
  status: CommandStatus;
  result: unknown;
  error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

export type LocalOutboxEvent = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: unknown;
  created_at: number;
};

export type IdempotentCommandHandle =
  | { mode: "execute"; entry: CommandInboxEntry }
  | { mode: "replay"; entry: CommandInboxEntry; result: unknown };

const commandInbox = readState<CommandInboxEntry[]>("commandInbox", []);
const localOutbox = readState<LocalOutboxEvent[]>("localOutbox", []);

export function beginIdempotentCommand(
  commandType: string,
  requestId: string,
  payload: unknown
): IdempotentCommandHandle {
  const normalizedRequestId = requestId.trim();

  if (!normalizedRequestId) {
    throw new Error("Command request_id is required.");
  }

  const payloadFingerprint = fingerprintPayload(payload);
  const existing = commandInbox.find(
    (entry) => entry.command_type === commandType && entry.request_id === normalizedRequestId
  );

  if (existing) {
    if (existing.payload_fingerprint !== payloadFingerprint) {
      throw new Error("Command request_id was already used with a different payload.");
    }

    if (existing.status === "COMPLETED") {
      return { mode: "replay", entry: existing, result: existing.result };
    }

    if (existing.status === "FAILED") {
      throw new Error(existing.error ?? "Command previously failed.");
    }

    throw new Error("Command is already in progress.");
  }

  const now = Date.now();
  const entry: CommandInboxEntry = {
    id: scopedId("cmd", now, commandInbox.length),
    command_type: commandType,
    request_id: normalizedRequestId,
    payload_fingerprint: payloadFingerprint,
    status: "IN_PROGRESS",
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
    completed_at: null
  };

  commandInbox.push(entry);
  persistCommandInbox();

  return { mode: "execute", entry };
}

export function completeIdempotentCommand<T>(entry: CommandInboxEntry, result: T): T {
  const now = Date.now();

  entry.status = "COMPLETED";
  entry.result = result;
  entry.error = null;
  entry.updated_at = now;
  entry.completed_at = now;
  persistCommandInbox();

  return result;
}

export function failIdempotentCommand(entry: CommandInboxEntry, error: unknown): never {
  const now = Date.now();

  entry.status = "FAILED";
  entry.error = error instanceof Error ? error.message : String(error);
  entry.updated_at = now;
  entry.completed_at = now;
  persistCommandInbox();

  throw error;
}

export function appendOutboxEvent(eventType: string, aggregateId: string, payload: unknown): LocalOutboxEvent {
  const now = Date.now();
  const event: LocalOutboxEvent = {
    id: scopedId("evt", now, localOutbox.length),
    event_type: eventType,
    aggregate_id: aggregateId,
    payload,
    created_at: now
  };

  localOutbox.push(event);
  writeState("localOutbox", localOutbox);

  return event;
}

function persistCommandInbox() {
  writeState("commandInbox", commandInbox);
}

function fingerprintPayload(payload: unknown) {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "__undefined";
  }

  if (Array.isArray(value)) {
    return "[" + value.map((item) => stableStringify(item)).join(",") + "]";
  }

  return "{" + Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => JSON.stringify(key) + ":" + stableStringify(item))
    .join(",") + "}";
}
