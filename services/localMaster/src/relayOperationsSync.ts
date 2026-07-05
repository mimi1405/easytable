import { getOpenTableOrderBasket, getTableLayout, listKdsTickets, listStationPickups } from "./store.js";
import type { BasketLine } from "./types.js";

type RelayRuntimeBinding = {
  tenant_id: string | null;
  location_id: string | null;
  local_master_instance_id: string | null;
  relay_base_url: string | null;
  relay_token: string | null;
};

export function getOperationsSnapshot(locationId: string) {
  const layout = getTableLayout(locationId);
  const now = Date.now();
  const openTableBaskets = layout.floors.flatMap((floor) =>
    floor.areas.flatMap((area) =>
      area.tables.flatMap((table) => {
        if (table.open_order_count <= 0) {
          return [];
        }

        const basket = getOpenTableOrderBasket(table.id);
        if (!basket) {
          return [];
        }

        const totals = calculateTotals(basket.lines);

        return [{
          table_id: table.id,
          table_name: table.name,
          table_context: {
            tenant_id: layout.tenant.id,
            location_id: layout.location.id,
            floor_id: floor.id,
            area_id: area.id,
            table_id: table.id,
            table_name: table.name,
            area_name: area.name,
            floor_name: floor.name,
            seats: table.seats
          },
          basket,
          subtotal: totals.subtotal,
          tax_total: totals.taxTotal,
          total: totals.total,
          opened_at: now,
          updated_at: now
        }];
      })
    )
  );

  return {
    kds_tickets: listKdsTickets(),
    open_table_baskets: openTableBaskets,
    station_pickups: listStationPickups("ALL"),
    synced_at: new Date().toISOString()
  };
}

export async function pushOperationsToRelay(binding: RelayRuntimeBinding): Promise<boolean> {
  if (!binding.location_id || !binding.relay_base_url || !binding.relay_token) {
    return false;
  }

  try {
    const response = await fetch(binding.relay_base_url.replace(/\/$/, "") + "/api/local-masters/operations", {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + binding.relay_token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(getOperationsSnapshot(binding.location_id))
    });

    if (!response.ok) {
      console.warn("Relay operations sync failed.", response.status, await readRelayError(response));
      return false;
    }

    return true;
  } catch (error) {
    console.warn("Relay operations sync failed.", error);
    return false;
  }
}

function calculateTotals(lines: BasketLine[]) {
  const total = lines.reduce((sum, line) => sum + line.line_total, 0);
  const taxTotal = lines.reduce((sum, line) => sum + calculateIncludedTax(line.line_total, line.tax_rate_bps), 0);

  return {
    subtotal: total - taxTotal,
    taxTotal,
    total
  };
}

function calculateIncludedTax(grossAmount: number, taxRateBps: number) {
  if (taxRateBps <= 0) {
    return 0;
  }

  return Math.round((grossAmount * taxRateBps) / (10_000 + taxRateBps));
}

async function readRelayError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? response.statusText;
  } catch {
    return (await response.text().catch(() => "")) || response.statusText;
  }
}
