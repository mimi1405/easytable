import { useEffect, useState } from "react";
import { useSession, signOut } from "@easytable/auth";
import { Login } from "@easytable/ui/pages/login/Login";
import { toast } from "sonner";

import { AppLayout } from "./layout/AppLayout";
import { defaultView, type AppView, type StaffModule } from "./layout/navigation";
import { detectConnectionMode, loadPosSettings, type LocationServiceMode } from "./lib/local-master";
import {
  listSelectableStaffContexts,
  resolveStoredStaffContext,
  staffContextStorageKey,
  type ActiveStaffContext,
  type StaffAuthContext,
} from "./lib/auth-context";
import { setActiveStaffConnectionContext } from "./lib/local-master";
import { AccountSetupPage } from "./modules/account-setup/AccountSetupPage";
import { KdsPage } from "./modules/kds/KdsPage";
import { OwnerAnalyticsPage } from "./modules/owner/analytics/OwnerAnalyticsPage";
import { OwnerCatalogPage } from "./modules/owner/catalog/OwnerCatalogPage";
import { OwnerEmployeesPage } from "./modules/owner/employees/OwnerEmployeesPage";
import { OwnerLocationsPage } from "./modules/owner/locations/OwnerLocationsPage";
import { clearStoredLocalSession, LocalStaffLogin, loadStoredLocalSession, type LocalStaffSession } from "./modules/local-auth/LocalStaffLogin";
import { ModulePlaceholder } from "./modules/placeholder/ModulePlaceholder";
import { StaffServicePage } from "./modules/staff/StaffServicePage";

function App() {
  if (window.location.pathname === "/account-setup") {
    return <AccountSetupPage />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { data: sessionData, isPending } = useSession();
  const [localSession, setLocalSession] = useState<LocalStaffSession | null>(null);
  const [localRuntime, setLocalRuntime] = useState<{ tenant_id: string; tenant_name: string; location_id: string; location_name: string; local_master_instance_id: string; service_mode: LocationServiceMode } | null>(null);
  const [localAuthChecked, setLocalAuthChecked] = useState(false);
  const [authDetails, setAuthDetails] = useState<StaffAuthContext | null>(null);
  const [activeContext, setActiveContext] = useState<ActiveStaffContext | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<AppView>(defaultView);
  const [effectiveServiceMode, setEffectiveServiceMode] = useState<LocationServiceMode>("TABLE_SERVICE");

  useEffect(() => {
    let mounted = true;
    void fetch("/api/runtime-context")
      .then(async (response) => response.ok ? response.json() : null)
      .then(async (runtime) => {
        if (!mounted || !runtime) return;
        setLocalRuntime(runtime);
        setLocalSession(await loadStoredLocalSession());
      })
      .catch(() => null)
      .finally(() => { if (mounted) setLocalAuthChecked(true); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (localSession && localRuntime) {
      const context: StaffAuthContext = {
        user: { id: localSession.user_id, email: localSession.email, name: localSession.display_name, role: "user" },
        tenants: [{
          tenantId: localRuntime.tenant_id,
          tenantName: localRuntime.tenant_name,
          role: localSession.role,
          locations: [{
            id: localRuntime.location_id,
            name: localRuntime.location_name,
            status: "ACTIVE",
            serviceMode: localRuntime.service_mode,
            localMasterInstanceId: localRuntime.local_master_instance_id,
            connectionStatus: "PAIRED",
          }],
        }],
      };
      setAuthDetails(context);
      setActiveContext(resolveStoredStaffContext(context, null));
      setAuthLoading(false);
      return;
    }
    if (!sessionData) {
      setAuthLoading(false);
      return;
    }
    
    let isMounted = true;
    async function fetchMe() {
      try {
        const res = await fetch(`${import.meta.env.VITE_RELAY_SYNC_URL || "http://localhost:3100"}/api/auth/me`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json() as StaffAuthContext;
          if (isMounted) {
            setAuthDetails(data);
            const storageKey = staffContextStorageKey(data.user.id);
            setActiveContext(resolveStoredStaffContext(data, window.localStorage.getItem(storageKey)));
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Auth-Details konnten nicht geladen werden.");
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
  }, [localRuntime, localSession, sessionData]);

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
  }, [activeContext]);

  if (isPending || !localAuthChecked || ((sessionData || localSession) && authLoading)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm font-semibold text-muted-foreground animate-pulse">
          Lade Session...
        </p>
      </div>
    );
  }

  if (!sessionData && !localSession && localRuntime) {
    return <LocalStaffLogin onAuthenticated={setLocalSession} />;
  }

  if (!sessionData && !localSession) {
    return <Login onSuccess={() => window.location.reload()} />;
  }

  const isPlatformAdmin = authDetails?.user?.role === "platform_admin";
  const availableContexts = authDetails ? listSelectableStaffContexts(authDetails) : [];

  if (!activeContext && availableContexts.length > 1 && authDetails) {
    return (
      <StaffContextSelection
        contexts={availableContexts}
        onSelect={(context) => {
          window.localStorage.setItem(staffContextStorageKey(authDetails.user.id), context.tenantId + ":" + context.locationId);
          setActiveContext(context);
        }}
        onLogout={async () => {
          await signOut();
          window.location.reload();
        }}
      />
    );
  }

  setActiveStaffConnectionContext(activeContext ? {
    tenantId: activeContext.tenantId,
    locationId: activeContext.locationId,
    localMasterInstanceId: activeContext.localMasterInstanceId,
  } : null);

  if (!activeContext) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-2xl font-bold text-destructive">Zugriff verweigert</h1>
        <p className="max-w-md text-muted-foreground">
          Dein Account ({sessionData?.user.email ?? localSession?.email}) hat keinen Zugriff auf diesen Mandanten.
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

  const userRole = isPlatformAdmin ? "platform_admin" : activeContext.role;
  const currentUser = {
    name: authDetails?.user?.name ?? sessionData?.user.name ?? localSession?.display_name,
    email: authDetails?.user?.email ?? sessionData?.user.email ?? localSession?.email,
    role: userRole,
  };
  const handleLogout = async () => {
    if (localSession) clearStoredLocalSession();
    else await signOut();
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
        activeView.ownerSection === "locations" ? (
          <OwnerLocationsPage />
        ) : activeView.ownerSection === "employees" ? (
          <OwnerEmployeesPage />
        ) : activeView.ownerSection === "analytics" ? (
          <OwnerAnalyticsPage />
        ) : (
          <OwnerCatalogPage section={activeView.ownerSection} />
        )
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

function StaffContextSelection({
  contexts,
  onSelect,
  onLogout,
}: {
  contexts: ActiveStaffContext[];
  onSelect: (context: ActiveStaffContext) => void;
  onLogout: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <section className="w-full max-w-xl rounded-md border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Standort auswählen</h1>
        <p className="mt-2 text-sm text-muted-foreground">Wähle den operativen Kontext für diese Staff-Sitzung.</p>
        <div className="mt-5 grid gap-3">
          {contexts.map((context) => (
            <button
              className="rounded-md border px-4 py-3 text-left hover:bg-muted"
              key={context.tenantId + ":" + context.locationId}
              onClick={() => onSelect(context)}
              type="button"
            >
              <span className="block font-semibold">{context.locationName}</span>
              <span className="text-sm text-muted-foreground">{context.tenantName} · {context.role}</span>
            </button>
          ))}
        </div>
        <button className="mt-5 text-sm font-medium text-muted-foreground underline" onClick={onLogout} type="button">Abmelden</button>
      </section>
    </main>
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
