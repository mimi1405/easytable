import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import * as schema from "./schema.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;
let hasMigrated = false;

export async function initializeDatabase() {
  const database = getDrizzleDatabase();

  if (!hasMigrated) {
    await migrate(database, { migrationsFolder: resolveRelaySyncApiPath("drizzle") });
    hasMigrated = true;
  }
}

export function getDrizzleDatabase() {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }

  return db;
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    hasMigrated = false;
  }
}

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is required for relaySyncApi.");
    }

    pool = new Pool({ connectionString });
  }

  return pool;
}

function resolveRelaySyncApiPath(...segments: string[]) {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)), ...segments);
}
