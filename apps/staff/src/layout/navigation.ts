export type StaffModule = "owner" | "staff" | "kds";
export type OwnerCatalogSection = "products" | "categories" | "taxes";

export type AppView = {
  module: StaffModule;
  ownerSection: OwnerCatalogSection;
};

export const defaultView: AppView = {
  module: "owner",
  ownerSection: "products"
};
