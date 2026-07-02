import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "./schema.js";

export async function seedRelaySyncDevData(database: NodePgDatabase<typeof schema>) {
  await database.execute(sql`
    WITH dev_locations AS (
      SELECT
        tenants.id AS tenant_id,
        locations.id AS location_id
      FROM tenants
      INNER JOIN locations ON locations.tenant_id = tenants.id
      WHERE lower(tenants.slug) IN ('basilika', 'basilica')
        AND lower(locations.slug) = 'hauptstandort'
    ),
    seed_stations AS (
      SELECT tenant_id, location_id, 'shisha' AS station_key, 'Shisha' AS name, 'KDS_AND_PRINTER' AS kind, 1 AS is_active, 10 AS sort_order FROM dev_locations
      UNION ALL
      SELECT tenant_id, location_id, 'bar' AS station_key, 'Bar' AS name, 'KDS_AND_PRINTER' AS kind, 1 AS is_active, 20 AS sort_order FROM dev_locations
      UNION ALL
      SELECT tenant_id, location_id, 'snack' AS station_key, 'Snack' AS name, 'KDS_AND_PRINTER' AS kind, 1 AS is_active, 30 AS sort_order FROM dev_locations
    )
    INSERT INTO catalog_output_stations (id, tenant_id, location_id, name, kind, is_active, sort_order)
    SELECT
      'station_' || replace(location_id, '-', '_') || '_' || station_key,
      tenant_id,
      location_id,
      name,
      kind,
      is_active,
      sort_order
    FROM seed_stations
    ON CONFLICT (id) DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id,
      location_id = EXCLUDED.location_id,
      name = EXCLUDED.name,
      kind = EXCLUDED.kind,
      is_active = EXCLUDED.is_active,
      sort_order = EXCLUDED.sort_order,
      updated_at = now()
  `);
}
