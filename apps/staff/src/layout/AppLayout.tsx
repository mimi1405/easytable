import type { ReactNode } from "react";
import { Bell, Building2, ChefHat, ClipboardList, Package, Percent, ReceiptText, ShieldCheck, Tags, Users } from "lucide-react";

import { AppShell, type AppShellNavigationGroup, type AppShellUser } from "@easytable/ui/layouts/app-shell";

import type { LocationServiceMode } from "../lib/local-master";
import type { AppView, OwnerCatalogSection, StaffModule, StaffScreen } from "./navigation";

type AppLayoutProps = {
  view: AppView;
  serviceMode: LocationServiceMode;
  onNavigate: (view: AppView) => void;
  allowedModules: StaffModule[];
  currentUser?: AppShellUser;
  onLogout?: () => void | Promise<void>;
  children: ReactNode;
};

const modules: Array<{
  module: StaffModule;
  label: string;
  icon: typeof ShieldCheck;
}> = [
  { module: "owner", label: "Owner", icon: ShieldCheck },
  { module: "staff", label: "Staff", icon: ClipboardList },
  { module: "kds", label: "KDS", icon: ChefHat },
];

const ownerCatalogItems: Array<{
  section: OwnerCatalogSection;
  label: string;
  icon: typeof Package;
}> = [
  { section: "products", label: "Produkte", icon: Package },
  { section: "categories", label: "Kategorien", icon: Tags },
  { section: "taxes", label: "Steuern", icon: Percent },
  { section: "locations", label: "Tischverwaltung", icon: Building2 },
  { section: "employees", label: "Mitarbeiter", icon: Users },
];

const staffItems: Array<{
  screen: Exclude<StaffScreen, "order">;
  label: string;
  icon: typeof ReceiptText;
}> = [
  { screen: "orders", label: "Bestellungen", icon: ReceiptText },
  { screen: "pickups", label: "Abholungen", icon: Bell },
];

export function AppLayout({ view, serviceMode, onNavigate, allowedModules, currentUser, onLogout, children }: AppLayoutProps) {
  return (
    <AppShell
      appLabel="easyTable Staff"
      currentUser={currentUser}
      navigationGroups={createNavigationGroups(view, serviceMode, allowedModules, onNavigate)}
      onLogout={onLogout}
      title={viewTitle(view)}
    >
      {children}
    </AppShell>
  );
}

function createNavigationGroups(
  view: AppView,
  serviceMode: LocationServiceMode,
  allowedModules: StaffModule[],
  onNavigate: (view: AppView) => void
): AppShellNavigationGroup[] {
  const isStaffModuleAvailable = serviceMode === "TABLE_SERVICE";

  return [
    {
      id: "modules",
      label: "Module",
      items: modules
        .filter((item) => allowedModules.includes(item.module))
        .filter((item) => item.module !== "staff" || isStaffModuleAvailable)
        .map((item) => {
          if (item.module === "owner") {
            return {
              id: item.module,
              label: item.label,
              icon: item.icon,
              isActive: view.module === "owner",
              onSelect: () => onNavigate({ module: "owner", ownerSection: "products", staffScreen: "orders", tableContext: null }),
              items: ownerCatalogItems.map((catalogItem) => ({
                id: catalogItem.section,
                label: catalogItem.label,
                icon: catalogItem.icon,
                isActive: view.module === "owner" && view.ownerSection === catalogItem.section,
                onSelect: () =>
                  onNavigate({ module: "owner", ownerSection: catalogItem.section, staffScreen: "orders", tableContext: null }),
              })),
            };
          }

          if (item.module === "staff") {
            return {
              id: item.module,
              label: item.label,
              icon: item.icon,
              isActive: view.module === "staff",
              onSelect: () => onNavigate({ module: "staff", ownerSection: "products", staffScreen: "orders", tableContext: null }),
              items: staffItems.map((staffItem) => ({
                id: staffItem.screen,
                label: staffItem.label,
                icon: staffItem.icon,
                isActive: view.module === "staff" && view.staffScreen === staffItem.screen,
                onSelect: () => onNavigate({ module: "staff", ownerSection: "products", staffScreen: staffItem.screen, tableContext: null }),
              })),
            };
          }

          return {
            id: item.module,
            label: item.label,
            icon: item.icon,
            isActive: view.module === item.module,
            onSelect: () => onNavigate({ module: item.module, ownerSection: "products", staffScreen: "orders", tableContext: null }),
          };
        }),
    },
  ];
}

function viewTitle(view: AppView) {
  if (view.module === "owner") {
    if (view.ownerSection === "locations") {
      return "Standorte / Tischplan";
    }

    if (view.ownerSection === "employees") {
      return "Owner / Mitarbeiter";
    }

    return view.ownerSection === "products" ? "Katalog / Produkte" : view.ownerSection === "categories" ? "Katalog / Kategorien" : "Katalog / Steuern";
  }

  if (view.module === "staff") {
    if (view.staffScreen === "order" && view.tableContext) {
      return `Staff / Tisch ${view.tableContext.table_name}`;
    }

    return view.staffScreen === "pickups" ? "Staff / Abholungen" : "Staff / Bestellungen";
  }

  return "KDS";
}
