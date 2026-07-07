import type { ReactNode } from "react";
import { Building2 } from "lucide-react";

import { AppShell, type AppShellUser } from "@easytable/ui/layouts/app-shell";

type AppLayoutProps = {
  currentUser?: AppShellUser;
  onLogout?: () => void | Promise<void>;
  children: ReactNode;
};

export function AppLayout({ currentUser, onLogout, children }: AppLayoutProps) {
  return (
    <AppShell
      appLabel="easyTable Platform"
      brandSubtitle="Platform"
      currentUser={currentUser}
      navigationGroups={[
        {
          id: "administration",
          label: "Administration",
          items: [{ id: "tenants", label: "Tenants", icon: Building2, isActive: true }],
        },
      ]}
      onLogout={onLogout}
      title="Tenants"
    >
      {children}
    </AppShell>
  );
}
