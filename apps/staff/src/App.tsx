import { useEffect, useState } from "react";
import { useSession, signOut } from "@easytable/auth";
import { Login } from "@easytable/ui/pages/login/Login";

import { AppLayout } from "./layout/AppLayout";
import { defaultView, type AppView, type StaffModule } from "./layout/navigation";
import { detectConnectionMode, loadPosSettings, type LocationServiceMode } from "./lib/local-master";
import { KdsPage } from "./modules/kds/KdsPage";
import { OwnerCatalogPage } from "./modules/owner/catalog/OwnerCatalogPage";
import { OwnerLocationsPage } from "./modules/owner/locations/OwnerLocationsPage";
import { ModulePlaceholder } from "./modules/placeholder/ModulePlaceholder";
import { StaffServicePage } from "./modules/staff/StaffServicePage";

function App() {
  const { data: sessionData, isPending } = useSession();
  const [authDetails, setAuthDetails] = useState<{
    user: any;
    tenants: Array<{ tenantId: string; role: string; tenantName: string }>;
  } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<AppView>(defaultView);
  const [effectiveServiceMode, setEffectiveServiceMode] = useState<LocationServiceMode>("TABLE_SERVICE");

  useEffect(() => {
    if (!sessionData) return;
    
    let isMounted = true;
    async function fetchMe() {
      try {
        const res = await fetch(`${import.meta.env.VITE_RELAY_SYNC_URL || "http://localhost:3100"}/api/auth/me`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setAuthDetails(data);
          }
        }
      } catch (err) {
        console.error("Error fetching auth details", err);
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    }
    void fetchMe();
    return () => {
      isMounted = false;
    };
  }, [sessionData]);

  useEffect(() => {
    let isMounted = true;

    async function loadEffectiveServiceMode() {
      try {
        const connectionMode = await detectConnectionMode();
        if (connectionMode !== "LOCAL") {
          if (isMounted) {
            setEffectiveServiceMode("TABLE_SERVICE");
          }
          return;
        }

        const settingsFile = await loadPosSettings();

        if (isMounted) {
          setEffectiveServiceMode(settingsFile.settings.service_mode ?? "TABLE_SERVICE");
        }
      } catch (error) {
        console.warn("Could not load Staff service mode.", error);

        if (isMounted) {
          setEffectiveServiceMode("TABLE_SERVICE");
        }
      }
    }

    void loadEffectiveServiceMode();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isPending || (sessionData && authLoading)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm font-semibold text-muted-foreground animate-pulse">
          Lade Session...
        </p>
      </div>
    );
  }

  if (!sessionData) {
    return <Login onSuccess={() => window.location.reload()} />;
  }

  const isPlatformAdmin = authDetails?.user?.role === "platform_admin";
  const targetTenantId = import.meta.env.VITE_RELAY_TENANT_ID;
  const tenantRelation = authDetails?.tenants?.find((t) => t.tenantId === targetTenantId);

  // If not platform admin, they must belong to this tenant
  if (!isPlatformAdmin && !tenantRelation) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-2xl font-bold text-destructive">Zugriff verweigert</h1>
        <p className="max-w-md text-muted-foreground">
          Dein Account ({sessionData.user.email}) hat keinen Zugriff auf diesen Mandanten.
        </p>
        <button
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={async () => {
            await signOut();
            window.location.reload();
          }}
        >
          Abmelden
        </button>
      </div>
    );
  }

  const userRole = isPlatformAdmin ? "platform_admin" : tenantRelation?.role;
  const currentUser = {
    name: authDetails?.user?.name ?? sessionData.user.name,
    email: authDetails?.user?.email ?? sessionData.user.email,
    role: userRole,
  };
  const handleLogout = async () => {
    await signOut();
    window.location.reload();
  };

  const isStaffModuleAvailable = effectiveServiceMode === "TABLE_SERVICE";
  const allowedModules = getAllowedModules(userRole);
  const visibleModules = allowedModules.filter((module) => module !== "staff" || isStaffModuleAvailable);
  const activeView = visibleModules.includes(view.module) ? view : defaultViewForModule(visibleModules[0] ?? "staff");

  const hasAccessToModule = (module: string) => {
    return visibleModules.includes(module as StaffModule);
  };

  if (!hasAccessToModule(activeView.module)) {
    return (
      <AppLayout
        allowedModules={allowedModules}
        currentUser={currentUser}
        onLogout={handleLogout}
        onNavigate={setView}
        serviceMode={effectiveServiceMode}
        view={activeView}
      >
        <div className="mx-auto grid min-h-[calc(100svh-7rem)] max-w-4xl place-items-center">
          <section className="w-full rounded-md border bg-card p-6 text-card-foreground shadow-sm sm:p-8 text-center">
            <h2 className="text-2xl font-semibold text-destructive">Zugriff verweigert</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Deine Rolle ({userRole}) berechtigt dich nicht zum Zugriff auf diesen Bereich ({activeView.module}).
            </p>
          </section>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      allowedModules={allowedModules}
      currentUser={currentUser}
      onLogout={handleLogout}
      onNavigate={setView}
      serviceMode={effectiveServiceMode}
      view={activeView}
    >
      {activeView.module === "owner" ? (
        activeView.ownerSection === "locations" ? <OwnerLocationsPage /> : <OwnerCatalogPage section={activeView.ownerSection} />
      ) : activeView.module === "staff" ? (
        isStaffModuleAvailable ? (
          <StaffServicePage
            screen={activeView.staffScreen}
            tableContext={activeView.tableContext}
            onBackToTables={() =>
              setView((current) => ({
                ...current,
                module: "staff",
                staffScreen: "orders",
                tableContext: null,
              }))
            }
            onSelectTable={(tableContext) =>
              setView((current) => ({
                ...current,
                module: "staff",
                staffScreen: "order",
                tableContext,
              }))
            }
          />
        ) : (
          <StaffModuleBlockedState />
        )
      ) : activeView.module === "kds" ? (
        <KdsPage />
      ) : (
        <ModulePlaceholder module={activeView.module} />
      )}
    </AppLayout>
  );
}

function getAllowedModules(userRole: string | undefined): StaffModule[] {
  if (userRole === "platform_admin") return ["owner", "staff", "kds"];
  if (userRole === "OWNER" || userRole === "MANAGER") return ["owner", "staff", "kds"];
  if (userRole === "STAFF") return ["staff"];
  if (userRole === "KDS") return ["kds"];
  return [];
}

function defaultViewForModule(module: StaffModule): AppView {
  return {
    module,
    ownerSection: "products",
    staffScreen: "orders",
    tableContext: null,
  };
}

function StaffModuleBlockedState() {
  return (
    <div className="mx-auto grid min-h-[calc(100svh-7rem)] max-w-4xl place-items-center">
      <section className="w-full rounded-md border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <div className="mb-4">
          <p className="text-sm font-medium text-muted-foreground">Counterbetrieb</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-normal">Staff-Service ist fuer diese Location deaktiviert</h2>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Diese Location verkauft direkt ueber die stationaere POS-Kasse. Kellner-, Tischplan- und Abholungs-Workflows werden
          deshalb nicht angezeigt.
        </p>
      </section>
    </div>
  );
}

export default App;
