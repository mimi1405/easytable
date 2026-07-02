import type { Location, LocationInput, OutputStation, OutputStationInput, Tenant, TenantInput } from "../../lib/relay-sync-api";

export type TenantFormState = {
  name: string;
  slug: string;
  email: string;
  phone: string;
  website: string;
  status: TenantInput["status"];
};

export type LocationFormState = {
  name: string;
  slug: string;
  address: string;
  local_master_instance_id: string;
  status: LocationInput["status"];
};

export type OutputStationFormState = {
  name: string;
  kind: OutputStationInput["kind"];
  is_active: boolean;
  sort_order: string;
};

export function createTenantFormState(tenant?: Tenant): TenantFormState {
  return {
    name: tenant?.name ?? "",
    slug: tenant?.slug ?? "",
    email: tenant?.email ?? "",
    phone: tenant?.phone ?? "",
    website: tenant?.website ?? "",
    status: tenant?.status ?? "ACTIVE",
  };
}

export function createLocationFormState(location?: Location): LocationFormState {
  return {
    name: location?.name ?? "",
    slug: location?.slug ?? "",
    address: location?.address ?? "",
    local_master_instance_id: location?.local_master_instance_id ?? "",
    status: location?.status ?? "ACTIVE",
  };
}

export function createOutputStationFormState(station?: OutputStation): OutputStationFormState {
  return {
    name: station?.name ?? "",
    kind: station?.kind ?? "KDS_AND_PRINTER",
    is_active: station?.is_active ?? true,
    sort_order: String(station?.sort_order ?? 10),
  };
}

export function normalizeOptionalText(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function formatStationKind(kind: OutputStation["kind"]) {
  if (kind === "KDS_AND_PRINTER") {
    return "KDS + Bon";
  }

  if (kind === "KDS") {
    return "Nur KDS";
  }

  return kind === "PRINTER" ? "Nur Bon" : "Keine Ausgabe";
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
