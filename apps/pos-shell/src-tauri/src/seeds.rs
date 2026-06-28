use rusqlite::{params, Connection};

use crate::util::current_timestamp_ms;

struct SeedTaxCode {
    id: &'static str,
    code: &'static str,
    name: &'static str,
    rate_bps: i64,
    is_default: bool,
}

struct SeedProduct {
    id: &'static str,
    product_type: &'static str,
    name: &'static str,
    category: &'static str,
    price: i64,
    tax_code_id: &'static str,
    station: &'static str,
}

struct SeedVariantGroup {
    id: &'static str,
    applies_to: &'static str,
    product_id: Option<&'static str>,
    category: Option<&'static str>,
    name: &'static str,
    selection_type: &'static str,
    min_select: i64,
    max_select: i64,
    sort_order: i64,
    is_required: bool,
}

struct SeedVariantGroupItem {
    id: &'static str,
    variant_group_id: &'static str,
    name: &'static str,
    price_delta: i64,
    is_default: bool,
    sort_order: i64,
}

struct SeedTenant {
    id: &'static str,
    name: &'static str,
}

struct SeedLocation {
    id: &'static str,
    tenant_id: &'static str,
    name: &'static str,
}

struct SeedFloor {
    id: &'static str,
    location_id: &'static str,
    name: &'static str,
    sort_order: i64,
}

struct SeedArea {
    id: &'static str,
    floor_id: &'static str,
    name: &'static str,
    sort_order: i64,
}

struct SeedTable {
    id: &'static str,
    area_id: &'static str,
    name: &'static str,
    seats: i64,
    sort_order: i64,
}

const SEED_TAX_CODES: &[SeedTaxCode] = &[
    SeedTaxCode {
        id: "tax_standard_ch",
        code: "CH_STANDARD",
        name: "MwSt 8.1%",
        rate_bps: 810,
        is_default: true,
    },
    SeedTaxCode {
        id: "tax_reduced_ch",
        code: "CH_REDUCED",
        name: "MwSt 2.9%",
        rate_bps: 290,
        is_default: false,
    },
];

const SEED_PRODUCTS: &[SeedProduct] = &[
    SeedProduct {
        id: "prod_invoice",
        product_type: "SERVICE",
        name: "Rechnung",
        category: "Service",
        price: 0,
        tax_code_id: "tax_standard_ch",
        station: "SERVICE",
    },
    SeedProduct {
        id: "prod_service_personal",
        product_type: "SERVICE",
        name: "Service Personal",
        category: "Service",
        price: 0,
        tax_code_id: "tax_standard_ch",
        station: "SERVICE",
    },
    SeedProduct {
        id: "prod_shisha_standard",
        product_type: "BASIC",
        name: "Shisha Standard",
        category: "Shisha",
        price: 3000,
        tax_code_id: "tax_standard_ch",
        station: "BAR",
    },
    SeedProduct {
        id: "prod_nava_shisha",
        product_type: "BASIC",
        name: "NAVA Shisha",
        category: "Shisha",
        price: 5900,
        tax_code_id: "tax_standard_ch",
        station: "BAR",
    },
    SeedProduct {
        id: "prod_smokezilla_laser_shisha",
        product_type: "BASIC",
        name: "SmokeZilla Laser Shisha",
        category: "Shisha",
        price: 8900,
        tax_code_id: "tax_standard_ch",
        station: "BAR",
    },
    SeedProduct {
        id: "prod_shisha_triple_skull",
        product_type: "BASIC",
        name: "Shisha Triple Skull",
        category: "Shisha",
        price: 4500,
        tax_code_id: "tax_standard_ch",
        station: "BAR",
    },
    SeedProduct {
        id: "prod_neuer_kopf",
        product_type: "SERVICE",
        name: "Neuer Kopf",
        category: "Shisha",
        price: 1500,
        tax_code_id: "tax_standard_ch",
        station: "BAR",
    },
    SeedProduct {
        id: "prod_kohle",
        product_type: "SERVICE",
        name: "Kohle",
        category: "Shisha",
        price: 0,
        tax_code_id: "tax_standard_ch",
        station: "BAR",
    },
    SeedProduct {
        id: "prod_mundstucke",
        product_type: "SERVICE",
        name: "Mundstucke",
        category: "Shisha",
        price: 300,
        tax_code_id: "tax_standard_ch",
        station: "BAR",
    },
    SeedProduct {
        id: "prod_chinotto",
        product_type: "BASIC",
        name: "Chinotto",
        category: "Sussgetranke",
        price: 700,
        tax_code_id: "tax_standard_ch",
        station: "BAR",
    },
];

const SEED_VARIANT_GROUPS: &[SeedVariantGroup] = &[SeedVariantGroup {
    id: "vgrp_shisha_standard_head",
    applies_to: "CATEGORY",
    product_id: None,
    category: Some("Shisha"),
    name: "Head",
    selection_type: "SINGLE",
    min_select: 1,
    max_select: 1,
    sort_order: 10,
    is_required: true,
}];

const SEED_VARIANT_GROUP_ITEMS: &[SeedVariantGroupItem] = &[
    SeedVariantGroupItem {
        id: "vitem_shisha_standard_head_standard",
        variant_group_id: "vgrp_shisha_standard_head",
        name: "Standard",
        price_delta: 0,
        is_default: true,
        sort_order: 10,
    },
    SeedVariantGroupItem {
        id: "vitem_shisha_standard_head_silver",
        variant_group_id: "vgrp_shisha_standard_head",
        name: "Silver",
        price_delta: 500,
        is_default: false,
        sort_order: 20,
    },
    SeedVariantGroupItem {
        id: "vitem_shisha_standard_head_premium",
        variant_group_id: "vgrp_shisha_standard_head",
        name: "Premium",
        price_delta: 1000,
        is_default: false,
        sort_order: 30,
    },
];

const SEED_TENANTS: &[SeedTenant] = &[SeedTenant {
    id: "tenant_basilica",
    name: "Basilica",
}];

const SEED_LOCATIONS: &[SeedLocation] = &[SeedLocation {
    id: "loc_basilica_main",
    tenant_id: "tenant_basilica",
    name: "Basilica",
}];

const SEED_FLOORS: &[SeedFloor] = &[
    SeedFloor {
        id: "floor_basilica_eg",
        location_id: "loc_basilica_main",
        name: "EG",
        sort_order: 10,
    },
    SeedFloor {
        id: "floor_basilica_og",
        location_id: "loc_basilica_main",
        name: "OG",
        sort_order: 20,
    },
];

const SEED_AREAS: &[SeedArea] = &[
    SeedArea {
        id: "area_basilica_bar",
        floor_id: "floor_basilica_eg",
        name: "Bar",
        sort_order: 10,
    },
    SeedArea {
        id: "area_basilica_fumoir",
        floor_id: "floor_basilica_eg",
        name: "Fumoir",
        sort_order: 20,
    },
    SeedArea {
        id: "area_basilica_lounges",
        floor_id: "floor_basilica_eg",
        name: "Lounges",
        sort_order: 30,
    },
    SeedArea {
        id: "area_basilica_raucherlounge",
        floor_id: "floor_basilica_eg",
        name: "Raucherlounge",
        sort_order: 40,
    },
    SeedArea {
        id: "area_basilica_og_lounge",
        floor_id: "floor_basilica_og",
        name: "Lounge",
        sort_order: 10,
    },
];

const SEED_TABLES: &[SeedTable] = &[
    SeedTable {
        id: "table_basilica_fumoir_2",
        area_id: "area_basilica_fumoir",
        name: "2",
        seats: 4,
        sort_order: 10,
    },
    SeedTable {
        id: "table_basilica_fumoir_3",
        area_id: "area_basilica_fumoir",
        name: "3",
        seats: 4,
        sort_order: 20,
    },
    SeedTable {
        id: "table_basilica_bar_1",
        area_id: "area_basilica_bar",
        name: "1",
        seats: 2,
        sort_order: 10,
    },
    SeedTable {
        id: "table_basilica_lounges_10",
        area_id: "area_basilica_lounges",
        name: "10",
        seats: 6,
        sort_order: 10,
    },
    SeedTable {
        id: "table_basilica_raucherlounge_20",
        area_id: "area_basilica_raucherlounge",
        name: "20",
        seats: 8,
        sort_order: 10,
    },
    SeedTable {
        id: "table_basilica_og_30",
        area_id: "area_basilica_og_lounge",
        name: "30",
        seats: 4,
        sort_order: 10,
    },
];

pub(crate) fn seed_tax_codes(connection: &Connection) -> Result<usize, String> {
    let now = current_timestamp_ms();
    let mut upserted = 0;

    connection
        .execute(
            "UPDATE tax_codes SET is_default = 0 WHERE is_default = 1",
            [],
        )
        .map_err(|error| format!("Could not reset default tax code: {error}"))?;

    for tax_code in SEED_TAX_CODES {
        upserted += connection
            .execute(
                "
                INSERT INTO tax_codes (
                  id, code, name, rate_bps, is_default, is_active, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
                ON CONFLICT(id) DO UPDATE SET
                  code = excluded.code,
                  name = excluded.name,
                  rate_bps = excluded.rate_bps,
                  is_default = excluded.is_default,
                  is_active = excluded.is_active,
                  updated_at = excluded.updated_at
                ",
                params![
                    tax_code.id,
                    tax_code.code,
                    tax_code.name,
                    tax_code.rate_bps,
                    tax_code.is_default as i64,
                    now
                ],
            )
            .map_err(|error| format!("Could not seed tax code {}: {error}", tax_code.id))?;
    }

    Ok(upserted)
}

pub(crate) fn seed_products(connection: &Connection) -> Result<usize, String> {
    let now = current_timestamp_ms();
    let mut upserted = 0;

    for product in SEED_PRODUCTS {
        upserted += connection
            .execute(
                "
                INSERT INTO products (
                  id, product_type, name, category, price, tax_code_id, station, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
                ON CONFLICT(id) DO UPDATE SET
                  product_type = excluded.product_type,
                  name = excluded.name,
                  category = excluded.category,
                  price = excluded.price,
                  tax_code_id = excluded.tax_code_id,
                  station = excluded.station,
                  updated_at = excluded.updated_at
                ",
                params![
                    product.id,
                    product.product_type,
                    product.name,
                    product.category,
                    product.price,
                    product.tax_code_id,
                    product.station,
                    now
                ],
            )
            .map_err(|error| format!("Could not seed product {}: {error}", product.id))?;
    }

    Ok(upserted)
}

pub(crate) fn seed_variant_groups(connection: &Connection) -> Result<usize, String> {
    let now = current_timestamp_ms();
    let mut upserted = 0;

    for group in SEED_VARIANT_GROUPS {
        upserted += connection
            .execute(
                "
                INSERT INTO product_variant_groups (
                  id, applies_to, product_id, category, name, selection_type, min_select, max_select,
                  sort_order, is_required, is_active, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?11)
                ON CONFLICT(id) DO UPDATE SET
                  applies_to = excluded.applies_to,
                  product_id = excluded.product_id,
                  category = excluded.category,
                  name = excluded.name,
                  selection_type = excluded.selection_type,
                  min_select = excluded.min_select,
                  max_select = excluded.max_select,
                  sort_order = excluded.sort_order,
                  is_required = excluded.is_required,
                  is_active = excluded.is_active,
                  updated_at = excluded.updated_at
                ",
                params![
                    group.id,
                    group.applies_to,
                    group.product_id,
                    group.category,
                    group.name,
                    group.selection_type,
                    group.min_select,
                    group.max_select,
                    group.sort_order,
                    group.is_required as i64,
                    now
                ],
            )
            .map_err(|error| format!("Could not seed variant group {}: {error}", group.id))?;
    }

    Ok(upserted)
}

pub(crate) fn seed_variant_group_items(connection: &Connection) -> Result<usize, String> {
    let now = current_timestamp_ms();
    let mut upserted = 0;

    for group in SEED_VARIANT_GROUPS {
        connection
            .execute(
                "
                UPDATE product_variant_group_items
                SET is_default = 0
                WHERE variant_group_id = ?1
                ",
                params![group.id],
            )
            .map_err(|error| {
                format!(
                    "Could not reset default variant item for {}: {error}",
                    group.id
                )
            })?;
    }

    for item in SEED_VARIANT_GROUP_ITEMS {
        upserted += connection
            .execute(
                "
                INSERT INTO product_variant_group_items (
                  id, variant_group_id, name, price_delta, is_default,
                  sort_order, is_active, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)
                ON CONFLICT(id) DO UPDATE SET
                  variant_group_id = excluded.variant_group_id,
                  name = excluded.name,
                  price_delta = excluded.price_delta,
                  is_default = excluded.is_default,
                  sort_order = excluded.sort_order,
                  is_active = excluded.is_active,
                  updated_at = excluded.updated_at
                ",
                params![
                    item.id,
                    item.variant_group_id,
                    item.name,
                    item.price_delta,
                    item.is_default as i64,
                    item.sort_order,
                    now
                ],
            )
            .map_err(|error| format!("Could not seed variant group item {}: {error}", item.id))?;
    }

    Ok(upserted)
}

fn seed_tenants(connection: &Connection) -> Result<usize, String> {
    let now = current_timestamp_ms();
    let mut upserted = 0;

    for tenant in SEED_TENANTS {
        upserted += connection
            .execute(
                "
                INSERT INTO tenants (id, name, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?3)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  updated_at = excluded.updated_at
                ",
                params![tenant.id, tenant.name, now],
            )
            .map_err(|error| format!("Could not seed tenant {}: {error}", tenant.id))?;
    }

    Ok(upserted)
}

fn seed_locations(connection: &Connection) -> Result<usize, String> {
    let now = current_timestamp_ms();
    let mut upserted = 0;

    for location in SEED_LOCATIONS {
        upserted += connection
            .execute(
                "
                INSERT INTO locations (id, tenant_id, name, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?4)
                ON CONFLICT(id) DO UPDATE SET
                  tenant_id = excluded.tenant_id,
                  name = excluded.name,
                  updated_at = excluded.updated_at
                ",
                params![location.id, location.tenant_id, location.name, now],
            )
            .map_err(|error| format!("Could not seed location {}: {error}", location.id))?;
    }

    Ok(upserted)
}

fn seed_floors(connection: &Connection) -> Result<usize, String> {
    let now = current_timestamp_ms();
    let mut upserted = 0;

    for floor in SEED_FLOORS {
        upserted += connection
            .execute(
                "
                INSERT INTO floors (id, location_id, name, sort_order, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                ON CONFLICT(id) DO UPDATE SET
                  location_id = excluded.location_id,
                  name = excluded.name,
                  sort_order = excluded.sort_order,
                  updated_at = excluded.updated_at
                ",
                params![
                    floor.id,
                    floor.location_id,
                    floor.name,
                    floor.sort_order,
                    now
                ],
            )
            .map_err(|error| format!("Could not seed floor {}: {error}", floor.id))?;
    }

    Ok(upserted)
}

fn seed_areas(connection: &Connection) -> Result<usize, String> {
    let now = current_timestamp_ms();
    let mut upserted = 0;

    for area in SEED_AREAS {
        upserted += connection
            .execute(
                "
                INSERT INTO areas (id, floor_id, name, sort_order, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                ON CONFLICT(id) DO UPDATE SET
                  floor_id = excluded.floor_id,
                  name = excluded.name,
                  sort_order = excluded.sort_order,
                  updated_at = excluded.updated_at
                ",
                params![area.id, area.floor_id, area.name, area.sort_order, now],
            )
            .map_err(|error| format!("Could not seed area {}: {error}", area.id))?;
    }

    Ok(upserted)
}

fn seed_tables(connection: &Connection) -> Result<usize, String> {
    let now = current_timestamp_ms();
    let mut upserted = 0;

    for table in SEED_TABLES {
        upserted += connection
            .execute(
                "
                INSERT INTO tables (id, area_id, name, seats, sort_order, is_active, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
                ON CONFLICT(id) DO UPDATE SET
                  area_id = excluded.area_id,
                  name = excluded.name,
                  seats = excluded.seats,
                  sort_order = excluded.sort_order,
                  is_active = excluded.is_active,
                  updated_at = excluded.updated_at
                ",
                params![
                    table.id,
                    table.area_id,
                    table.name,
                    table.seats,
                    table.sort_order,
                    now
                ],
            )
            .map_err(|error| format!("Could not seed table {}: {error}", table.id))?;
    }

    Ok(upserted)
}

pub(crate) fn seed_table_layout(
    connection: &Connection,
) -> Result<(usize, usize, usize, usize, usize), String> {
    let tenants = seed_tenants(connection)?;
    let locations = seed_locations(connection)?;
    let floors = seed_floors(connection)?;
    let areas = seed_areas(connection)?;
    let tables = seed_tables(connection)?;

    Ok((tenants, locations, floors, areas, tables))
}
