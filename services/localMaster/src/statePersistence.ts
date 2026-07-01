import { eq } from "drizzle-orm";

import { getDrizzleDatabase } from "./db/client.js";
import { localState } from "./db/schema.js";

export function readState<T>(key: string, fallback: T): T {
  const row = getDrizzleDatabase()
    .select({ valueJson: localState.valueJson })
    .from(localState)
    .where(eq(localState.key, key))
    .get();

  if (!row) {
    return fallback;
  }

  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}

export function writeState(key: string, value: unknown) {
  const valueJson = JSON.stringify(value);

  getDrizzleDatabase()
    .insert(localState)
    .values({ key, valueJson, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: localState.key,
      set: {
        valueJson,
        updatedAt: Date.now()
      }
    })
    .run();
}
