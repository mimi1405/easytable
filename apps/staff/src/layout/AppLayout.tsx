import type { ReactNode } from "react";
import { ChefHat, ClipboardList, LayoutDashboard, Package, Percent, ShieldCheck, Tags } from "lucide-react";

import { Separator } from "@easytable/ui/components/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@easytable/ui/components/sidebar";
import { TooltipProvider } from "@easytable/ui/components/tooltip";

import type { AppView, OwnerCatalogSection, StaffModule } from "./navigation";

type AppLayoutProps = {
  view: AppView;
  onNavigate: (view: AppView) => void;
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
];

export function AppLayout({ view, onNavigate, children }: AppLayoutProps) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar onNavigate={onNavigate} view={view} />
        <SidebarInset className="min-h-svh bg-background">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
            <SidebarTrigger className="shrink-0" />
            <Separator className="h-5" orientation="vertical" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">easyTable Staff</p>
              <h1 className="truncate text-base font-semibold">{viewTitle(view)}</h1>
            </div>
          </header>
          <main className="flex-1 px-3 py-4 sm:px-5 lg:px-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function AppSidebar({ view, onNavigate }: Pick<AppLayoutProps, "view" | "onNavigate">) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="h-12" size="lg" tooltip="easyTable">
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">easyTable</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Module</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {modules.map((item) => {
                const Icon = item.icon;

                if (item.module === "owner") {
                  return (
                    <SidebarMenuItem key={item.module}>
                      <SidebarMenuButton
                        isActive={view.module === "owner"}
                        onClick={() => onNavigate({ module: "owner", ownerSection: "products" })}
                        tooltip={item.label}
                        type="button"
                      >
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      <SidebarMenuSub>
                        {ownerCatalogItems.map((catalogItem) => {
                          const CatalogIcon = catalogItem.icon;

                          return (
                            <SidebarMenuSubItem key={catalogItem.section}>
                              <SidebarMenuSubButton
                                data-active={view.module === "owner" && view.ownerSection === catalogItem.section}
                                onClick={() => onNavigate({ module: "owner", ownerSection: catalogItem.section })}
                              >
                                <CatalogIcon className="size-3.5" />
                                <span>{catalogItem.label}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={item.module}>
                    <SidebarMenuButton
                      isActive={view.module === item.module}
                      onClick={() => onNavigate({ module: item.module, ownerSection: "products" })}
                      tooltip={item.label}
                      type="button"
                    >
                      <Icon className="size-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="h-auto items-start py-2" tooltip="Dev">
              <LayoutDashboard className="mt-0.5 size-4" />
              <span className="block truncate text-sm font-medium">Dev sichtbar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function viewTitle(view: AppView) {
  if (view.module === "owner") {
    return view.ownerSection === "products" ? "Katalog / Produkte" : view.ownerSection === "categories" ? "Katalog / Kategorien" : "Katalog / Steuern";
  }

  return view.module === "staff" ? "Staff" : "KDS";
}
