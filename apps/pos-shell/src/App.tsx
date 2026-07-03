import { useEffect, useState } from "react";

import { loadPosSettings } from "./lib/local-master-client";
import type { LocationServiceMode, TableContext } from "./lib/pos-types";
import { CashRegisterScreen } from "./screens/CashRegisterScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { TablePlanScreen } from "./screens/TablePlanScreen";

export type PosScreen = "tables" | "cash" | "more" | "logout";

function App() {
  const [serviceMode, setServiceMode] =
    useState<LocationServiceMode>("TABLE_SERVICE");
  const [activeScreen, setActiveScreen] = useState<PosScreen | null>(null);
  const [selectedTableContext, setSelectedTableContext] =
    useState<TableContext | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadStartupSettings() {
      try {
        const settingsFile = await loadPosSettings();
        const nextServiceMode =
          settingsFile.settings.service_mode ?? "TABLE_SERVICE";

        if (!isMounted) {
          return;
        }

        setServiceMode(nextServiceMode);
        setActiveScreen(
          nextServiceMode === "COUNTER_SERVICE" ? "cash" : "tables",
        );
      } catch (error) {
        console.warn("Could not load POS service mode.", error);

        if (isMounted) {
          setServiceMode("TABLE_SERVICE");
          setActiveScreen("tables");
        }
      }
    }

    void loadStartupSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  function handleTableSelect(context: TableContext) {
    setSelectedTableContext(context);
    setActiveScreen("cash");
  }

  function handleNavigate(screen: PosScreen) {
    if (serviceMode === "COUNTER_SERVICE" && screen === "tables") {
      setSelectedTableContext(null);
      setActiveScreen("cash");
      return;
    }

    if (
      serviceMode === "TABLE_SERVICE" &&
      screen === "cash" &&
      !selectedTableContext
    ) {
      setActiveScreen("tables");
      return;
    }

    setActiveScreen(screen);
  }

  if (!activeScreen) {
    return (
      <main className="flex h-svh touch-manipulation items-center justify-center bg-[#f6f7fb] p-6 text-slate-950">
        <p className="text-sm font-black uppercase text-slate-400">
          POS wird geladen.
        </p>
      </main>
    );
  }

  if (activeScreen === "tables") {
    return (
      <TablePlanScreen
        onNavigate={handleNavigate}
        onSelectTable={handleTableSelect}
      />
    );
  }

  if (activeScreen === "cash") {
    return (
      <CashRegisterScreen
        serviceMode={serviceMode}
        tableContext={selectedTableContext}
        onNavigate={handleNavigate}
        onOrderCreated={() => {
          setSelectedTableContext(null);
          setActiveScreen(
            serviceMode === "COUNTER_SERVICE" ? "cash" : "tables",
          );
        }}
      />
    );
  }

  if (activeScreen === "more") {
    return <MoreScreen onNavigate={handleNavigate} />;
  }

  return (
    <main className="flex h-svh touch-manipulation items-center justify-center bg-[#f6f7fb] p-6 text-slate-950">
      <section className="flex w-full max-w-md flex-col items-center gap-5 rounded-md bg-white p-8 text-center shadow-md shadow-slate-200/80 ring-1 ring-slate-200">
        <p className="text-sm font-black uppercase text-indigo-800">
          Abmelden
        </p>
        <p className="text-base font-bold text-slate-500">
          Dieser POS Bereich wird als eigener Screen gerendert.
        </p>
        <button
          className="h-12 rounded-md bg-slate-950 px-5 text-sm font-black uppercase text-white transition active:scale-[0.98]"
          onClick={() => handleNavigate("tables")}
        >
          Zur Kasse
        </button>
      </section>
    </main>
  );
}

export default App;
