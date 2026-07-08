import type { ReactNode } from "react";
import { Building2, Users } from "lucide-react";
import { AppShell, type AppShellUser } from "@easytable/ui/layouts/app-shell";

import type { PlatformAdminView } from "./navigation";

type AppLayoutProps = {
  view: PlatformAdminView;
  onNavigate: (view: PlatformAdminView) => void;
  currentUser?: AppShellUser;
  onLogout?: () => void | Promise<void>;
  children: ReactNode;
};

export function AppLayout({ view, onNavigate, currentUser, onLogout, children }: AppLayoutProps) {
  return (
    <AppShell
      appLabel="easyTable Platform"
      brandSubtitle="Platform"
      currentUser={currentUser}
      navigationGroups={[
        {
          id: "administration",
          label: "Administration",
          items: [
            { id: "tenants", 
              label: "Tenants", 
              icon: Building2, 
              isActive: view === "tenants",
              onSelect: () => onNavigate("tenants"),
            },
            { id: "administrators", 
              label: "Administratoren", 
              icon: Users, 
              isActive: view === "administrators",
              onSelect: () => onNavigate("administrators"),
            },
          ],
        },
      ]}
      onLogout={onLogout}
      title={view === "administrators" ? "Administratoren" : "Tenants"}
    >
      {children}
    </AppShell>
  );
}
