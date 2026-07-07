import type { ComponentType, ReactNode } from "react";
import { LogOut } from "lucide-react";

import { Button } from "@easytable/ui/components/button";
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

const brandLogoUrl = new URL("../assets/Logo table.svg", import.meta.url).href;

type AppShellIcon = ComponentType<{ className?: string }>;

export type AppShellUser = {
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

export type AppShellNavigationItem = {
  id: string;
  label: string;
  icon: AppShellIcon;
  isActive?: boolean;
  onSelect?: () => void;
  items?: Array<{
    id: string;
    label: string;
    icon?: AppShellIcon;
    isActive?: boolean;
    onSelect?: () => void;
  }>;
};

export type AppShellNavigationGroup = {
  id: string;
  label: string;
  items: AppShellNavigationItem[];
};

export type AppShellProps = {
  appLabel: string;
  brandLabel?: string;
  brandSubtitle?: string;
  title: string;
  navigationGroups: AppShellNavigationGroup[];
  currentUser?: AppShellUser;
  onLogout?: () => void | Promise<void>;
  children: ReactNode;
};

export function AppShell({
  appLabel,
  brandLabel = "easyTable",
  title,
  navigationGroups,
  currentUser,
  onLogout,
  children,
}: AppShellProps) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppShellSidebar
          brandLabel={brandLabel}
          currentUser={currentUser}
          navigationGroups={navigationGroups}
        />
        <SidebarInset className="min-h-svh bg-background">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:px-4">
            <SidebarTrigger className="shrink-0" />
            <Separator className="h-5" orientation="vertical" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{appLabel}</p>
              <h1 className="truncate text-base font-semibold">{title}</h1>
            </div>
            {onLogout ? (
              <Button className="shrink-0 gap-2" onClick={onLogout} size="sm" type="button" variant="destructive">
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Abmelden</span>
              </Button>
            ) : null}
          </header>
          <main className="flex-1 px-3 py-4 sm:px-5 lg:px-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function AppShellSidebar({
  brandLabel,
  currentUser,
  navigationGroups,
}: Pick<AppShellProps, "brandLabel" | "currentUser" | "navigationGroups">) {
  const displayName = getUserDisplayName(currentUser);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center">
        <div className="flex h-10 min-w-0 items-center gap-2 px-2 text-sm leading-tight group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <img alt="" aria-hidden="true" className="size-10 shrink-0 object-contain" src={brandLogoUrl} />
          <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">{brandLabel}</span>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        {navigationGroups.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <AppShellNavigationMenuItem item={item} key={item.id} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="h-14 justify-center">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-10 items-center group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
              tooltip={displayName}
              type="button"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                {getUserInitials(currentUser)}
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-medium">{displayName}</span>
                {currentUser?.role ? <span className="truncate text-xs text-muted-foreground">{currentUser.role}</span> : null}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function AppShellNavigationMenuItem({ item }: { item: AppShellNavigationItem }) {
  const Icon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={item.isActive} onClick={item.onSelect} tooltip={item.label} type="button">
        <Icon className="size-4" />
        <span>{item.label}</span>
      </SidebarMenuButton>
      {item.items?.length ? (
        <SidebarMenuSub>
          {item.items.map((subItem) => {
            const SubIcon = subItem.icon;

            return (
              <SidebarMenuSubItem key={subItem.id}>
                <SidebarMenuSubButton data-active={subItem.isActive} onClick={subItem.onSelect}>
                  {SubIcon ? <SubIcon className="size-3.5" /> : null}
                  <span>{subItem.label}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

function getUserDisplayName(user?: AppShellUser) {
  return user?.name?.trim() || user?.email?.trim() || "Account";
}

function getUserInitials(user?: AppShellUser) {
  const source = getUserDisplayName(user);
  const nameParts = source
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);

  if (nameParts.length >= 2) {
    return (nameParts[0][0] + nameParts[1][0]).toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}
