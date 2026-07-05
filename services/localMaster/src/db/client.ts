import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema.js";

let sqlite: Database.Database | null = null;
let db: BetterSQLite3Database<typeof schema> | null = null;

export function getDrizzleDatabase() {
  if (!db) {
    const sqliteClient = getSqliteClient();
    db = drizzle(sqliteClient, { schema });
    migrate(db, { migrationsFolder: resolveLocalMasterPath("drizzle") });
    migrateLocalMasterSchema(sqliteClient);
  }

  return db;
}

function getSqliteClient() {
  if (sqlite) {
    return sqlite;
  }

  const dbPath = resolveDatabasePath(process.env.LOCAL_MASTER_DB_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });

  sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");

  return sqlite;
}

function resolveLocalMasterPath(...segments: string[]) {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ...segments);
}

function resolveRepositoryPath(...segments: string[]) {
  return resolveLocalMasterPath("..", "..", ...segments);
}

function resolveDatabasePath(configuredPath: string | undefined) {
  if (!configuredPath) {
    return resolveLocalMasterPath("data", "local-master.sqlite3");
  }

  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }

  const normalizedPath = configuredPath.replace(/\\/g, "/");
  if (normalizedPath === "services/localMaster" || normalizedPath.startsWith("services/localMaster/")) {
    return resolveRepositoryPath(normalizedPath);
  }

  return resolveLocalMasterPath(configuredPath);
}

function migrateLocalMasterSchema(sqliteClient: Database.Database) {
  sqliteClient
    .prepare(
      `CREATE TABLE IF NOT EXISTS layout_floors (
        id TEXT PRIMARY KEY,
        location_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    )
    .run();
  sqliteClient
    .prepare("CREATE INDEX IF NOT EXISTS idx_layout_floors_location ON layout_floors(location_id, sort_order, name)")
    .run();
  sqliteClient
    .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_layout_floors_location_name ON layout_floors(location_id, name)")
    .run();

  sqliteClient
    .prepare(
      `CREATE TABLE IF NOT EXISTS layout_areas (
        id TEXT PRIMARY KEY,
        floor_id TEXT NOT NULL REFERENCES layout_floors(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    )
    .run();
  sqliteClient
    .prepare("CREATE INDEX IF NOT EXISTS idx_layout_areas_floor ON layout_areas(floor_id, sort_order, name)")
    .run();
  sqliteClient
    .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_layout_areas_floor_name ON layout_areas(floor_id, name)")
    .run();

  sqliteClient
    .prepare(
      `CREATE TABLE IF NOT EXISTS layout_tables (
        id TEXT PRIMARY KEY,
        area_id TEXT NOT NULL REFERENCES layout_areas(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        seats INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    )
    .run();
  sqliteClient
    .prepare("CREATE INDEX IF NOT EXISTS idx_layout_tables_area ON layout_tables(area_id, sort_order, name)")
    .run();
  sqliteClient
    .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_layout_tables_area_name ON layout_tables(area_id, name)")
    .run();

  const categoryColumns = sqliteClient
    .prepare("PRAGMA table_info(catalog_categories)")
    .all() as Array<{ name: string }>;

  if (!categoryColumns.some((column) => column.name === "default_station_id")) {
    sqliteClient.prepare("ALTER TABLE catalog_categories ADD COLUMN default_station_id TEXT REFERENCES catalog_output_stations(id) ON DELETE SET NULL").run();
  }

  const stationColumns = sqliteClient
    .prepare("PRAGMA table_info(catalog_output_stations)")
    .all() as Array<{ name: string }>;

  if (!stationColumns.some((column) => column.name === "has_kds")) {
    sqliteClient.prepare("ALTER TABLE catalog_output_stations ADD COLUMN has_kds INTEGER NOT NULL DEFAULT 0").run();
  }

  if (!stationColumns.some((column) => column.name === "has_printer")) {
    sqliteClient.prepare("ALTER TABLE catalog_output_stations ADD COLUMN has_printer INTEGER NOT NULL DEFAULT 0").run();
  }

  sqliteClient
    .prepare(
      "UPDATE catalog_output_stations SET has_kds = 1 WHERE kind IN ('KDS', 'KDS_AND_PRINTER') AND has_kds = 0"
    )
    .run();
  sqliteClient
    .prepare(
      "UPDATE catalog_output_stations SET has_printer = 1 WHERE kind IN ('PRINTER', 'KDS_AND_PRINTER') AND has_printer = 0"
    )
    .run();
}
