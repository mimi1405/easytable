export type StaffModule = "owner" | "staff" | "kds";
export type OwnerCatalogSection = "products" | "categories" | "taxes" | "locations" | "employees";
export type StaffScreen = "orders" | "order" | "pickups";

export type StaffTableContext = {
  tenant_id: string;
  location_id: string;
  floor_id: string;
  area_id: string;
  table_id: string;
  table_name: string;
  area_name: string;
  floor_name: string;
  seats: number;
};

export type AppView = {
  module: StaffModule;
  ownerSection: OwnerCatalogSection;
  staffScreen: StaffScreen;
  tableContext: StaffTableContext | null;
};

export const defaultView: AppView = {
  module: "owner",
  ownerSection: "products",
  staffScreen: "orders",
  tableContext: null,
};
