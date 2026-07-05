import {
  listCatalogCategories,
  listCatalogOutputStations,
  listCatalogTaxes
} from "./catalogStore.js";
import { listProductVariantGroups, listProducts } from "./store.js";

type RelayRuntimeBinding = {
  tenant_id: string | null;
  location_id: string | null;
  local_master_instance_id: string | null;
  relay_base_url: string | null;
  relay_token: string | null;
};

export function getCatalogSnapshot() {
  const products = listProducts();

  return {
    products,
    categories: listCatalogCategories(),
    taxes: listCatalogTaxes(),
    output_stations: listCatalogOutputStations(),
    product_variant_groups: products.flatMap((product) => listProductVariantGroups(product.id))
  };
}

export async function pushCatalogToRelay(binding: RelayRuntimeBinding): Promise<boolean> {
  if (!binding.location_id || !binding.relay_base_url || !binding.relay_token) {
    return false;
  }

  try {
    const response = await fetch(binding.relay_base_url.replace(/\/$/, "") + "/api/local-masters/catalog", {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + binding.relay_token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(getCatalogSnapshot())
    });

    if (!response.ok) {
      console.warn("Relay catalog sync failed.", response.status, await readRelayError(response));
      return false;
    }

    return true;
  } catch (error) {
    console.warn("Relay catalog sync failed.", error);
    return false;
  }
}

async function readRelayError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? response.statusText;
  } catch {
    return (await response.text().catch(() => "")) || response.statusText;
  }
}
