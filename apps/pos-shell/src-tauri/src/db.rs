use rusqlite::Connection;
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};

use crate::seeds::{
    seed_products, seed_table_layout, seed_tax_codes, seed_variant_group_items, seed_variant_groups,
};

/// Shared SQLite connection – wrapped in a Mutex so every Tauri command
/// serialises access through the same single connection, preventing
/// SQLITE_BUSY / "database is locked" races between concurrent commands.
pub(crate) struct DbState(pub Mutex<Connection>);

#[derive(Serialize)]
pub(crate) struct PosDatabaseInfo {
    path: String,
    seeded_tenants: usize,
    seeded_locations: usize,
    seeded_floors: usize,
    seeded_areas: usize,
    seeded_tables: usize,
    seeded_tax_codes: usize,
    seeded_products: usize,
    seeded_variant_groups: usize,
    seeded_variant_group_items: usize,
}

pub(crate) fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;

    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;

    Ok(data_dir.join("easytable-pos.sqlite3"))
}

pub(crate) fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let conn = Connection::open(path)
        .map_err(|e| format!("Could not open SQLite database: {e}"))?;

    // Set busy_timeout via the C API first (before any SQL) so it is active
    // for every subsequent statement on this connection.
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("Could not set SQLite busy timeout: {e}"))?;

    // WAL mode is NOT used here: we share a single Mutex<Connection> across
    // all Tauri commands, so concurrency is handled at the Rust level. WAL
    // would require an exclusive file-header write which can fail on Windows.
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Could not configure SQLite connection: {e}"))?;

    Ok(conn)
}


/// Open the database, run migrations + seeds, then return the ready-to-use
/// connection so the caller can store it as shared application state.
pub(crate) fn setup_database(app: &AppHandle) -> Result<Connection, String> {
    let conn = open_database(app)?;

    migrate_database(&conn)?;
    seed_table_layout(&conn)?;
    seed_tax_codes(&conn)?;
    seed_products(&conn)?;
    seed_variant_groups(&conn)?;
    seed_variant_group_items(&conn)?;

    Ok(conn)
}


pub(crate) fn migrate_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS tenants (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS locations (
              id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL,
              name TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              FOREIGN KEY(tenant_id) REFERENCES tenants(id)
            );

            CREATE TABLE IF NOT EXISTS floors (
              id TEXT PRIMARY KEY,
              location_id TEXT NOT NULL,
              name TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              FOREIGN KEY(location_id) REFERENCES locations(id)
            );

            CREATE TABLE IF NOT EXISTS areas (
              id TEXT PRIMARY KEY,
              floor_id TEXT NOT NULL,
              name TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              FOREIGN KEY(floor_id) REFERENCES floors(id)
            );

            CREATE TABLE IF NOT EXISTS tables (
              id TEXT PRIMARY KEY,
              area_id TEXT NOT NULL,
              name TEXT NOT NULL,
              seats INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL DEFAULT 0,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              FOREIGN KEY(area_id) REFERENCES areas(id)
            );

            CREATE TABLE IF NOT EXISTS tax_codes (
              id TEXT PRIMARY KEY,
              code TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              rate_bps INTEGER NOT NULL,
              is_default INTEGER NOT NULL DEFAULT 0,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS products (
              id TEXT PRIMARY KEY,
              product_type TEXT NOT NULL DEFAULT 'BASIC' CHECK(product_type IN ('BASIC','SERVICE')),
              name TEXT NOT NULL,
              category TEXT NOT NULL DEFAULT 'Alle',
              price INTEGER NOT NULL,
              tax_code_id TEXT NOT NULL DEFAULT 'tax_standard_ch',
              is_available INTEGER NOT NULL DEFAULT 1,
              station TEXT NOT NULL DEFAULT 'KITCHEN',
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              FOREIGN KEY(tax_code_id) REFERENCES tax_codes(id)
            );

            CREATE TABLE IF NOT EXISTS product_variant_groups (
              id TEXT PRIMARY KEY,
              applies_to TEXT NOT NULL DEFAULT 'PRODUCT' CHECK(applies_to IN ('PRODUCT','CATEGORY')),
              product_id TEXT,
              category TEXT,
              name TEXT NOT NULL,
              selection_type TEXT NOT NULL DEFAULT 'SINGLE' CHECK(selection_type IN ('SINGLE','MULTIPLE')),
              min_select INTEGER NOT NULL DEFAULT 0,
              max_select INTEGER NOT NULL DEFAULT 1,
              sort_order INTEGER NOT NULL DEFAULT 0,
              is_required INTEGER NOT NULL DEFAULT 0,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              CHECK(
                (applies_to = 'PRODUCT' AND product_id IS NOT NULL)
                OR (applies_to = 'CATEGORY' AND category IS NOT NULL)
              ),
              FOREIGN KEY(product_id) REFERENCES products(id)
            );

            CREATE TABLE IF NOT EXISTS product_variant_group_items (
              id TEXT PRIMARY KEY,
              variant_group_id TEXT NOT NULL,
              name TEXT NOT NULL,
              price_delta INTEGER NOT NULL DEFAULT 0 CHECK(price_delta >= 0),
              is_default INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL DEFAULT 0,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              FOREIGN KEY(variant_group_id) REFERENCES product_variant_groups(id)
            );

            CREATE TABLE IF NOT EXISTS orders (
              id TEXT PRIMARY KEY,
              order_number TEXT UNIQUE NOT NULL,
              tenant_id TEXT,
              location_id TEXT,
              floor_id TEXT,
              area_id TEXT,
              table_id TEXT,
              table_name TEXT,
              service_mode TEXT NOT NULL DEFAULT 'TABLE',
              status TEXT NOT NULL DEFAULT 'OPEN',
              subtotal INTEGER NOT NULL DEFAULT 0,
              tax_total INTEGER NOT NULL DEFAULT 0,
              total INTEGER NOT NULL DEFAULT 0,
              payment_status TEXT NOT NULL DEFAULT 'UNPAID',
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              closed_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS order_items (
              id TEXT PRIMARY KEY,
              order_id TEXT NOT NULL,
              product_id TEXT,
              product_type TEXT NOT NULL DEFAULT 'BASIC',
              product_name TEXT NOT NULL,
              product_category TEXT NOT NULL DEFAULT '',
              quantity INTEGER NOT NULL,
              unit_price INTEGER NOT NULL,
              tax_code_id TEXT,
              tax_code_name TEXT NOT NULL DEFAULT '',
              tax_rate_bps INTEGER NOT NULL,
              tax_amount INTEGER NOT NULL,
              total_price INTEGER NOT NULL,
              station TEXT DEFAULT 'KITCHEN',
              notes TEXT,
              created_at INTEGER NOT NULL,
              FOREIGN KEY(order_id) REFERENCES orders(id)
            );

            CREATE TABLE IF NOT EXISTS order_item_variant_snapshots (
              id TEXT PRIMARY KEY,
              order_item_id TEXT NOT NULL,
              variant_group_id TEXT,
              variant_group_name TEXT NOT NULL,
              variant_item_id TEXT,
              variant_item_name TEXT NOT NULL,
              price_delta INTEGER NOT NULL,
              created_at INTEGER NOT NULL,
              FOREIGN KEY(order_item_id) REFERENCES order_items(id)
            );

            CREATE TABLE IF NOT EXISTS payments (
              id TEXT PRIMARY KEY,
              order_id TEXT NOT NULL,
              amount INTEGER NOT NULL,
              received_cash INTEGER,
              change_given INTEGER,
              method TEXT NOT NULL CHECK(method IN ('CASH','CARD_MANUAL','WALLEE')),
              status TEXT NOT NULL CHECK(status IN ('COMPLETED','FAILED','PENDING','CANCELED')),
              provider TEXT,
              provider_transaction_id TEXT,
              provider_status TEXT,
              created_at INTEGER NOT NULL,
              FOREIGN KEY(order_id) REFERENCES orders(id)
            );

            CREATE TABLE IF NOT EXISTS cash_sessions (
              id TEXT PRIMARY KEY,
              opened_at INTEGER NOT NULL,
              closed_at INTEGER,
              opening_cash INTEGER NOT NULL DEFAULT 0,
              closing_cash_expected INTEGER,
              closing_cash_counted INTEGER,
              difference INTEGER,
              status TEXT NOT NULL DEFAULT 'OPEN'
            );

            CREATE TABLE IF NOT EXISTS cash_movements (
              id TEXT PRIMARY KEY,
              cash_session_id TEXT NOT NULL,
              type TEXT NOT NULL CHECK(type IN ('OPENING','SALE','CASH_IN','CASH_OUT','CLOSING')),
              amount INTEGER NOT NULL,
              reason TEXT,
              created_at INTEGER NOT NULL,
              FOREIGN KEY(cash_session_id) REFERENCES cash_sessions(id)
            );

            CREATE TABLE IF NOT EXISTS print_jobs (
              id TEXT PRIMARY KEY,
              type TEXT NOT NULL CHECK(type IN ('RECEIPT','KITCHEN_SLIP','BAR_SLIP','DRAWER')),
              payload_json TEXT NOT NULL,
              station TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              error_message TEXT,
              created_at INTEGER NOT NULL,
              completed_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS day_closes (
              id TEXT PRIMARY KEY,
              date TEXT NOT NULL UNIQUE,
              total_cash INTEGER NOT NULL,
              total_card INTEGER NOT NULL,
              order_count INTEGER NOT NULL,
              item_count INTEGER NOT NULL,
              report_json TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            ",
        )
        .map_err(|error| format!("Could not migrate SQLite database: {error}"))?;

    add_column_if_missing(
        connection,
        "products",
        "product_type",
        "product_type TEXT NOT NULL DEFAULT 'BASIC'",
    )?;
    add_column_if_missing(
        connection,
        "products",
        "tax_code_id",
        "tax_code_id TEXT NOT NULL DEFAULT 'tax_standard_ch'",
    )?;
    add_column_if_missing(
        connection,
        "product_variant_groups",
        "applies_to",
        "applies_to TEXT NOT NULL DEFAULT 'PRODUCT'",
    )?;
    add_column_if_missing(
        connection,
        "product_variant_groups",
        "category",
        "category TEXT",
    )?;
    relax_variant_group_product_id_constraint(connection)?;
    add_column_if_missing(
        connection,
        "order_items",
        "product_type",
        "product_type TEXT NOT NULL DEFAULT 'BASIC'",
    )?;
    add_column_if_missing(
        connection,
        "order_items",
        "product_category",
        "product_category TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(connection, "order_items", "tax_code_id", "tax_code_id TEXT")?;
    add_column_if_missing(
        connection,
        "order_items",
        "tax_code_name",
        "tax_code_name TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(connection, "orders", "tenant_id", "tenant_id TEXT")?;
    add_column_if_missing(connection, "orders", "location_id", "location_id TEXT")?;
    add_column_if_missing(connection, "orders", "floor_id", "floor_id TEXT")?;
    add_column_if_missing(connection, "orders", "area_id", "area_id TEXT")?;
    add_column_if_missing(connection, "orders", "table_id", "table_id TEXT")?;
    add_column_if_missing(connection, "orders", "table_name", "table_name TEXT")?;
    add_column_if_missing(
        connection,
        "orders",
        "service_mode",
        "service_mode TEXT NOT NULL DEFAULT 'TABLE'",
    )?;
    add_column_if_missing(connection, "payments", "received_cash", "received_cash INTEGER")?;
    add_column_if_missing(connection, "payments", "change_given", "change_given INTEGER")?;

    Ok(())
}

fn relax_variant_group_product_id_constraint(connection: &Connection) -> Result<(), String> {
    if !column_is_not_null(connection, "product_variant_groups", "product_id")? {
        return Ok(());
    }

    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = OFF;

            ALTER TABLE product_variant_groups RENAME TO product_variant_groups_legacy;
            ALTER TABLE product_variant_group_items RENAME TO product_variant_group_items_legacy;

            CREATE TABLE product_variant_groups (
              id TEXT PRIMARY KEY,
              applies_to TEXT NOT NULL DEFAULT 'PRODUCT' CHECK(applies_to IN ('PRODUCT','CATEGORY')),
              product_id TEXT,
              category TEXT,
              name TEXT NOT NULL,
              selection_type TEXT NOT NULL DEFAULT 'SINGLE' CHECK(selection_type IN ('SINGLE','MULTIPLE')),
              min_select INTEGER NOT NULL DEFAULT 0,
              max_select INTEGER NOT NULL DEFAULT 1,
              sort_order INTEGER NOT NULL DEFAULT 0,
              is_required INTEGER NOT NULL DEFAULT 0,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              CHECK(
                (applies_to = 'PRODUCT' AND product_id IS NOT NULL)
                OR (applies_to = 'CATEGORY' AND category IS NOT NULL)
              ),
              FOREIGN KEY(product_id) REFERENCES products(id)
            );

            INSERT INTO product_variant_groups (
              id, applies_to, product_id, category, name, selection_type, min_select, max_select,
              sort_order, is_required, is_active, created_at, updated_at
            )
            SELECT
              id, applies_to, product_id, category, name, selection_type, min_select, max_select,
              sort_order, is_required, is_active, created_at, updated_at
            FROM product_variant_groups_legacy;

            CREATE TABLE product_variant_group_items (
              id TEXT PRIMARY KEY,
              variant_group_id TEXT NOT NULL,
              name TEXT NOT NULL,
              price_delta INTEGER NOT NULL DEFAULT 0 CHECK(price_delta >= 0),
              is_default INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL DEFAULT 0,
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              FOREIGN KEY(variant_group_id) REFERENCES product_variant_groups(id)
            );

            INSERT INTO product_variant_group_items (
              id, variant_group_id, name, price_delta, is_default,
              sort_order, is_active, created_at, updated_at
            )
            SELECT
              id, variant_group_id, name, price_delta, is_default,
              sort_order, is_active, created_at, updated_at
            FROM product_variant_group_items_legacy;

            DROP TABLE product_variant_group_items_legacy;
            DROP TABLE product_variant_groups_legacy;

            PRAGMA foreign_keys = ON;
            ",
        )
        .map_err(|error| {
            format!("Could not relax product_variant_groups.product_id constraint: {error}")
        })?;

    Ok(())
}

fn column_exists(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Could not inspect {table}: {error}"))?;

    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Could not read {table} columns: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not parse {table} columns: {error}"))?;

    Ok(columns.iter().any(|existing| existing == column))
}

fn column_is_not_null(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Could not inspect {table}: {error}"))?;

    let columns = statement
        .query_map([], |row| Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)?)))
        .map_err(|error| format!("Could not read {table} columns: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not parse {table} columns: {error}"))?;

    Ok(columns
        .iter()
        .any(|(existing, not_null)| existing == column && *not_null == 1))
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    column_definition: &str,
) -> Result<(), String> {
    if column_exists(connection, table, column)? {
        return Ok(());
    }

    // SQLite can add columns safely, but cannot retrofit all constraints on legacy tables.
    connection
        .execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column_definition}"),
            [],
        )
        .map_err(|error| format!("Could not add {table}.{column}: {error}"))?;

    Ok(())
}


#[tauri::command]
pub(crate) fn initialize_pos_database(
    app: AppHandle,
    state: State<DbState>,
) -> Result<PosDatabaseInfo, String> {
    let conn = state.0.lock().map_err(|_| "Database lock poisoned".to_string())?;

    // Run migrations and seeds through the already-open shared connection.
    migrate_database(&conn)?;
    let (seeded_tenants, seeded_locations, seeded_floors, seeded_areas, seeded_tables) =
        seed_table_layout(&conn)?;
    let seeded_tax_codes = seed_tax_codes(&conn)?;
    let seeded_products = seed_products(&conn)?;
    let seeded_variant_groups = seed_variant_groups(&conn)?;
    let seeded_variant_group_items = seed_variant_group_items(&conn)?;
    let path = database_path(&app)?;

    Ok(PosDatabaseInfo {
        path: path.display().to_string(),
        seeded_tenants,
        seeded_locations,
        seeded_floors,
        seeded_areas,
        seeded_tables,
        seeded_tax_codes,
        seeded_products,
        seeded_variant_groups,
        seeded_variant_group_items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seeds::{seed_products, seed_tax_codes, seed_variant_groups};

    #[test]
    fn migrate_relaxes_legacy_variant_group_product_id_constraint() {
        let connection = Connection::open_in_memory().expect("open in-memory database");

        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;

                CREATE TABLE tax_codes (
                  id TEXT PRIMARY KEY,
                  code TEXT NOT NULL UNIQUE,
                  name TEXT NOT NULL,
                  rate_bps INTEGER NOT NULL,
                  is_default INTEGER NOT NULL DEFAULT 0,
                  is_active INTEGER NOT NULL DEFAULT 1,
                  created_at INTEGER NOT NULL,
                  updated_at INTEGER
                );

                CREATE TABLE products (
                  id TEXT PRIMARY KEY,
                  product_type TEXT NOT NULL DEFAULT 'BASIC',
                  name TEXT NOT NULL,
                  category TEXT NOT NULL DEFAULT 'Alle',
                  price INTEGER NOT NULL,
                  tax_code_id TEXT NOT NULL DEFAULT 'tax_standard_ch',
                  is_available INTEGER NOT NULL DEFAULT 1,
                  station TEXT NOT NULL DEFAULT 'KITCHEN',
                  created_at INTEGER NOT NULL,
                  updated_at INTEGER,
                  FOREIGN KEY(tax_code_id) REFERENCES tax_codes(id)
                );

                CREATE TABLE product_variant_groups (
                  id TEXT PRIMARY KEY,
                  applies_to TEXT NOT NULL DEFAULT 'PRODUCT',
                  product_id TEXT NOT NULL,
                  category TEXT,
                  name TEXT NOT NULL,
                  selection_type TEXT NOT NULL DEFAULT 'SINGLE',
                  min_select INTEGER NOT NULL DEFAULT 0,
                  max_select INTEGER NOT NULL DEFAULT 1,
                  sort_order INTEGER NOT NULL DEFAULT 0,
                  is_required INTEGER NOT NULL DEFAULT 0,
                  is_active INTEGER NOT NULL DEFAULT 1,
                  created_at INTEGER NOT NULL,
                  updated_at INTEGER,
                  FOREIGN KEY(product_id) REFERENCES products(id)
                );

                CREATE TABLE product_variant_group_items (
                  id TEXT PRIMARY KEY,
                  variant_group_id TEXT NOT NULL,
                  name TEXT NOT NULL,
                  price_delta INTEGER NOT NULL DEFAULT 0,
                  is_default INTEGER NOT NULL DEFAULT 0,
                  sort_order INTEGER NOT NULL DEFAULT 0,
                  is_active INTEGER NOT NULL DEFAULT 1,
                  created_at INTEGER NOT NULL,
                  updated_at INTEGER,
                  FOREIGN KEY(variant_group_id) REFERENCES product_variant_groups(id)
                );
                ",
            )
            .expect("create legacy schema");

        migrate_database(&connection).expect("migrate legacy database");
        seed_tax_codes(&connection).expect("seed tax codes");
        seed_products(&connection).expect("seed products");
        seed_variant_groups(&connection).expect("seed variant groups");

        let product_id: Option<String> = connection
            .query_row(
                "
                SELECT product_id
                FROM product_variant_groups
                WHERE id = 'vgrp_shisha_standard_head'
                ",
                [],
                |row| row.get(0),
            )
            .expect("read seeded variant group");

        assert_eq!(product_id, None);
    }

    #[test]
    fn migrate_adds_cash_audit_columns_to_existing_payments_table() {
        let connection = Connection::open_in_memory().expect("open in-memory database");

        connection
            .execute_batch(
                "
                CREATE TABLE payments (
                  id TEXT PRIMARY KEY,
                  order_id TEXT NOT NULL,
                  amount INTEGER NOT NULL,
                  method TEXT NOT NULL,
                  status TEXT NOT NULL,
                  provider TEXT,
                  provider_transaction_id TEXT,
                  provider_status TEXT,
                  created_at INTEGER NOT NULL
                );
                ",
            )
            .expect("create legacy payments table");

        migrate_database(&connection).expect("migrate database");

        assert!(column_exists(&connection, "payments", "received_cash").expect("inspect column"));
        assert!(column_exists(&connection, "payments", "change_given").expect("inspect column"));
    }
}
