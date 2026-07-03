import { useEffect, useState } from "react";

import { AppLayout } from "./layout/AppLayout";
import { defaultView, type AppView } from "./layout/navigation";
import { loadPosSettings, type LocationServiceMode } from "./lib/local-master";
import { KdsPage } from "./modules/kds/KdsPage";
import { OwnerCatalogPage } from "./modules/owner/catalog/OwnerCatalogPage";
import { ModulePlaceholder } from "./modules/placeholder/ModulePlaceholder";
import { StaffServicePage } from "./modules/staff/StaffServicePage";

function App() {
  const [view, setView] = useState<AppView>(defaultView);
  const [effectiveServiceMode, setEffectiveServiceMode] = useState<LocationServiceMode>("TABLE_SERVICE");

  useEffect(() => {
    let isMounted = true;

    async function loadEffectiveServiceMode() {
      try {
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

  const isStaffModuleAvailable = effectiveServiceMode === "TABLE_SERVICE";

  return (
    <AppLayout onNavigate={setView} serviceMode={effectiveServiceMode} view={view}>
      {view.module === "owner" ? (
        <OwnerCatalogPage section={view.ownerSection} />
      ) : view.module === "staff" ? (
        isStaffModuleAvailable ? (
          <StaffServicePage
            screen={view.staffScreen}
            tableContext={view.tableContext}
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
      ) : view.module === "kds" ? (
        <KdsPage />
      ) : (
        <ModulePlaceholder module={view.module} />
      )}
    </AppLayout>
  );
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
