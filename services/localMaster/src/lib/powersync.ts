import { Worker } from "node:worker_threads";
import { PowerSyncDatabase, Schema, Table, column, type PowerSyncBackendConnector, type PowerSyncCredentials } from "@powersync/node";
import { getRelayRuntimeBinding } from "../cloudBinding.js";

// Define the PowerSync Schema matching our local master SQLite tables
export const localMasterPowerSyncSchema = new Schema({
  tenants: new Table({
    name: column.text,
    slug: column.text,
    email: column.text,
    phone: column.text,
    website: column.text,
    status: column.text,
    created_at: column.text,
    updated_at: column.text,
  }),
  locations: new Table({
    tenant_id: column.text,
    name: column.text,
    slug: column.text,
    address: column.text,
    local_master_instance_id: column.text,
    service_mode: column.text,
    status: column.text,
    created_at: column.text,
    updated_at: column.text,
  }),
  layout_floors: new Table({
    location_id: column.text,
    name: column.text,
    sort_order: column.integer,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  layout_areas: new Table({
    floor_id: column.text,
    name: column.text,
    sort_order: column.integer,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  layout_tables: new Table({
    area_id: column.text,
    name: column.text,
    seats: column.integer,
    sort_order: column.integer,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  catalog_categories: new Table({
    tenant_id: column.text,
    location_id: column.text,
    name: column.text,
    sort_order: column.integer,
    default_station_id: column.text,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  catalog_taxes: new Table({
    tenant_id: column.text,
    location_id: column.text,
    name: column.text,
    rate_bps: column.integer,
    sort_order: column.integer,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  catalog_output_stations: new Table({
    tenant_id: column.text,
    location_id: column.text,
    name: column.text,
    kind: column.text,
    has_kds: column.integer,
    has_printer: column.integer,
    is_active: column.integer,
    sort_order: column.integer,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  catalog_products: new Table({
    tenant_id: column.text,
    location_id: column.text,
    category_id: column.text,
    tax_id: column.text,
    product_type: column.text,
    name: column.text,
    price: column.integer,
    tax_code_id: column.text,
    tax_code_name: column.text,
    tax_rate_bps: column.integer,
    is_available: column.integer,
    station_id: column.text,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  orders: new Table({
    tenant_id: column.text,
    location_id: column.text,
    local_master_instance_id: column.text,
    order_number: column.text,
    service_mode: column.text,
    source: column.text,
    status: column.text,
    subtotal: column.integer,
    tax_total: column.integer,
    total: column.integer,
    payment_status: column.text,
    opened_at: column.integer,
    closed_at: column.integer,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  order_items: new Table({
    tenant_id: column.text,
    order_id: column.text,
    product_id: column.text,
    product_type: column.text,
    product_name: column.text,
    product_category: column.text,
    quantity: column.integer,
    unit_price: column.integer,
    tax_code_id: column.text,
    tax_code_name: column.text,
    tax_rate_bps: column.integer,
    tax_amount: column.integer,
    total_price: column.integer,
    station: column.text,
    notes: column.text,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  station_pickups: new Table({
    tenant_id: column.text,
    location_id: column.text,
    order_id: column.text,
    order_number: column.text,
    table_id: column.text,
    table_name: column.text,
    station: column.text,
    status: column.text,
    items_json: column.text,
    ready_at: column.integer,
    acknowledged_at: column.integer,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  kds_tickets: new Table({
    tenant_id: column.text,
    location_id: column.text,
    order_id: column.text,
    order_number: column.text,
    table_id: column.text,
    table_name: column.text,
    station: column.text,
    status: column.text,
    items_json: column.text,
    done_at: column.integer,
    created_at: column.integer,
    updated_at: column.integer,
  }),
  payments: new Table({
    tenant_id: column.text,
    order_id: column.text,
    amount: column.integer,
    received_cash: column.integer,
    change_given: column.integer,
    method: column.text,
    status: column.text,
    provider: column.text,
    provider_transaction_id: column.text,
    provider_status: column.text,
    paid_at: column.integer,
    created_at: column.integer,
    updated_at: column.integer,
  })
});

class LocalMasterPowerSyncConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const binding = getRelayRuntimeBinding();
    if (!binding) {
      throw new Error("LocalMaster not paired with relay");
    }

    const response = await fetch(`${binding.relay_base_url}/api/local-masters/powersync-token`, {
      headers: {
        Authorization: `Bearer ${binding.relay_token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PowerSync token: ${response.statusText}`);
    }

    const { token } = await response.json() as { token: string };

    return {
      endpoint: process.env.POWERSYNC_URL ?? "http://localhost:8080",
      token
    };
  }

  async uploadData(database: any): Promise<void> {
    const batch = await database.getCrudBatch();
    if (!batch) return;

    const binding = getRelayRuntimeBinding();
    if (!binding) {
      throw new Error("LocalMaster not paired with relay");
    }

    try {
      const response = await fetch(`${binding.relay_base_url}/api/local-masters/powersync-upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${binding.relay_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(batch)
      });

      if (!response.ok) {
        throw new Error(`Failed to upload local changes: ${response.statusText}`);
      }

      await batch.complete();
    } catch (error) {
      console.warn("PowerSync upload failed:", error);
      throw error;
    }
  }
}

let powersyncDb: PowerSyncDatabase | null = null;

export function getPowerSyncDatabase(dbFilename: string): PowerSyncDatabase {
  if (!powersyncDb) {
    powersyncDb = new PowerSyncDatabase({
      schema: localMasterPowerSyncSchema,
      database: {
        dbFilename,
        openWorker: (_, options) => {
          return new Worker(new URL("./powersync.worker.js", import.meta.url), options) as any;
        }
      }
    });
  }
  return powersyncDb;
}

export async function startPowerSync(dbFilename: string) {
  const db = getPowerSyncDatabase(dbFilename);
  const connector = new LocalMasterPowerSyncConnector();
  await db.connect(connector);
  console.log("PowerSync connected and syncing.");
}
