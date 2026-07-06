import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import { locations, relayCommands } from "../db/schema.js";
import { publishCommandEvent } from "../lib/nats.js";

/**
 * Debounce map: locationId → timer handle.
 * Prevents sending multiple bootstrap refresh commands when several admin
 * changes happen in rapid succession (e.g. bulk station edits).
 */
const pendingRefreshTimers = new Map<string, NodeJS.Timeout>();
const debounceMs = Number(process.env.ADMIN_SYNC_DEBOUNCE_MS ?? 1_000);

/**
 * Schedule a bootstrap-refresh command for the given location.
 * If a refresh is already pending for this location, it is replaced (debounced).
 * This is fire-and-forget — callers should not await this.
 */
export function triggerLocalMasterBootstrapRefresh(tenantId: string, locationId: string) {
  const key = `${tenantId}:${locationId}`;
  const existing = pendingRefreshTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    pendingRefreshTimers.delete(key);
    void sendBootstrapRefreshCommand(tenantId, locationId);
  }, debounceMs);

  // Don't keep the process alive just for the debounce timer
  timer.unref?.();
  pendingRefreshTimers.set(key, timer);
}

async function sendBootstrapRefreshCommand(tenantId: string, locationId: string) {
  try {
    const db = getDrizzleDatabase();
    const locationRow = (await db
      .select({ id: locations.id, localMasterInstanceId: locations.localMasterInstanceId })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
      .limit(1))[0];

    if (!locationRow?.localMasterInstanceId) {
      // No LocalMaster paired for this location — nothing to notify
      return;
    }

    const instanceId = locationRow.localMasterInstanceId;
    const commandId = "admin_refresh_" + randomUUID();
    const now = new Date();

    await db.insert(relayCommands).values({
      id: commandId,
      tenantId,
      locationId,
      localMasterInstanceId: instanceId,
      type: "ADMIN_BOOTSTRAP_REFRESH",
      status: "pending",
      payloadJson: { triggered_at: now.toISOString() },
      resultJson: null,
      deliveredAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    void publishCommandEvent(tenantId, locationId, instanceId, commandId);
    console.log(`Admin bootstrap refresh command queued for location ${locationId} (command: ${commandId})`);
  } catch (error) {
    console.warn("Failed to trigger admin bootstrap refresh:", error);
  }
}
