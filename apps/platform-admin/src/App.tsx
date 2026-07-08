import { useEffect, useState } from "react";
import { useSession, signOut } from "@easytable/auth";
import { Login } from "@easytable/ui/pages/login/Login";

import { getRelaySyncApiUrl } from "./lib/relay-sync-api";
import { AppLayout } from "./layout/AppLayout";
import { defaultView, type PlatformAdminView } from "./layout/navigation";
import { AccountSetupPage } from "./modules/account-setup/AccountSetupPage";
import { Administrators } from "./modules/platform-administration/Administrators";
import { TenantsPage } from "./modules/tenants/TenantsPage";

type AuthDetails = {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role?: string | null;
  };
  tenants: Array<{
    tenantId: string;
    role: string;
    tenantName: string;
  }>;
};

function App() {
  if (window.location.pathname === "/account-setup") {
    return <AccountSetupPage />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { data: sessionData, isPending } = useSession();
  const [authDetails, setAuthDetails] = useState<AuthDetails | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<PlatformAdminView>(defaultView);

  useEffect(() => {
    if (!sessionData) {
      setAuthDetails(null);
      setAuthLoading(false);
      return;
    }

    let isMounted = true;

    async function loadAuthDetails() {
      setAuthLoading(true);

      try {
        const response = await fetch(getRelaySyncApiUrl() + "/api/auth/me", {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(String(response.status));
        }

        const payload = (await response.json()) as AuthDetails;

        if (isMounted) {
          setAuthDetails(payload);
        }
      } catch {
        if (isMounted) {
          setAuthDetails(null);
        }
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    }

    void loadAuthDetails();

    return () => {
      isMounted = false;
    };
  }, [sessionData]);

  if (isPending || authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm font-semibold text-muted-foreground animate-pulse">Lade Session...</p>
      </div>
    );
  }

  if (!sessionData) {
    return <Login onSuccess={() => window.location.reload()} />;
  }

  const user = authDetails?.user ?? sessionData.user;
  const isPlatformAdmin = authDetails?.user.role === "platform_admin" && authDetails.tenants.length === 0;
  const handleLogout = async () => {
    await signOut();
    window.location.reload();
  };

  if (!isPlatformAdmin) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-2xl font-bold text-destructive">Zugriff verweigert</h1>
        <p className="max-w-md text-muted-foreground">
          Dieser Bereich ist ausschliesslich fuer Plattform-Administratoren reserviert. Dein Account ({user.email}) verfuegt
          nicht ueber die erforderlichen Rechte.
        </p>
        {authDetails?.tenants.length ? (
          <p className="max-w-md text-sm text-muted-foreground">
            Dieser Account ist einem Tenant zugeordnet und gilt deshalb nicht als Platform-Admin.
          </p>
        ) : null}
        <button
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={handleLogout}
        >
          Abmelden
        </button>
      </div>
    );
  }

  return (
    <AppLayout
      currentUser={{ email: user.email, name: user.name, role: "platform_admin" }}
      onLogout={handleLogout}
      onNavigate={setView}
      view={view}
    >
      {view === "administrators" ? <Administrators /> : <TenantsPage />}
    </AppLayout>
  );
}

export default App;
