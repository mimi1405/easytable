export type TenantStatus = "ACTIVE" | "SUSPENDED";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
};

export type TenantCreateRequest = {
  name: string;
  slug: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  status?: TenantStatus;
};

export type TenantUpdateRequest = Partial<TenantCreateRequest>;

export type LocationStatus = "ACTIVE" | "SUSPENDED";

export type Location = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  address: string | null;
  local_master_instance_id: string | null;
  status: LocationStatus;
  created_at: string;
  updated_at: string;
};

export type LocationCreateRequest = {
  name: string;
  slug: string;
  address?: string | null;
  local_master_instance_id?: string | null;
  status?: LocationStatus;
};

export type LocationUpdateRequest = Partial<LocationCreateRequest>;

export type CatalogOutputStationKind = "KDS_AND_PRINTER" | "KDS" | "PRINTER" | "NONE";

export type CatalogOutputStation = {
  id: string;
  tenant_id: string;
  location_id: string | null;
  name: string;
  kind: CatalogOutputStationKind;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CatalogOutputStationCreateRequest = {
  name: string;
  kind: CatalogOutputStationKind;
  is_active?: boolean;
  sort_order?: number;
};

export type CatalogOutputStationUpdateRequest = Partial<CatalogOutputStationCreateRequest>;
