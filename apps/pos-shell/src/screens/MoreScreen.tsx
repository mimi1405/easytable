import { PrinterIcon, SettingsIcon, Undo2Icon, WalletCardsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@easytable/ui/lib/utils";
import { Card, CardContent } from "@easytable/ui/components/card";

import type { PosScreen } from "../App";
import { loadPosSettings } from "../lib/local-master-client";
import type { PosSettingsFile } from "../lib/pos-types";
import { CashCloseScreen } from "./CashCloseScreen";
import { PosBottomNav } from "./PosBottomNav";
import { StornoScreen } from "./StornoScreen";
import { DeviceSettingsScreen } from "./more/DeviceSettingsScreen";
import { LocalMasterSettingsScreen } from "./more/LocalMasterSettingsScreen";

type MoreScreenProps = {
  onNavigate: (screen: PosScreen) => void;
};

const moreItems = [
  {
    label: "Einstellungen",
    description: "System",
    icon: SettingsIcon,
    tone: "bg-slate-950 text-white",
    view: "local-master-settings",
  },
  {
    label: "Geräte",
    description: "KDS & Drucker",
    icon: PrinterIcon,
    tone: "bg-slate-100 text-slate-700",
    view: "devices",
  },
  {
    label: "Kassenabschluss",
    description: "Tagesabschluss",
    icon: WalletCardsIcon,
    tone: "bg-slate-100 text-slate-700",
    view: "cash-close",
  },
  {
    label: "Storno",
    description: "Korrekturen",
    icon: Undo2Icon,
    tone: "bg-slate-100 text-slate-700",
    view: "storno",
  },
] as const;

type MoreView = "menu" | "cash-close" | "local-master-settings" | "devices" | "storno";

export function MoreScreen({ onNavigate }: MoreScreenProps) {
  const [activeView, setActiveView] = useState<MoreView>("menu");
  const [settingsFile, setSettingsFile] = useState<PosSettingsFile | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      try {
        const loadedSettings = await loadPosSettings();

        if (isMounted) {
          setSettingsFile(loadedSettings);
        }
      } catch (error) {
        console.warn("Could not load POS settings file.", error);
      }
    }

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  if (activeView === "cash-close") {
    return <CashCloseScreen onBack={() => setActiveView("menu")} />;
  }

  if (activeView === "storno") {
    return <StornoScreen onBack={() => setActiveView("menu")} />;
  }

  if (activeView === "local-master-settings") {
    return <LocalMasterSettingsScreen settingsFile={settingsFile} onBack={() => setActiveView("menu")} />;
  }

  if (activeView === "devices") {
    return <DeviceSettingsScreen onBack={() => setActiveView("menu")} />;
  }

  return (
    <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-muted/30 text-foreground">
      <section className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 lg:p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">Mehr</h1>
            <p className="mt-1 text-sm text-muted-foreground">Kasse verwalten und weitere Funktionen öffnen.</p>
          </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {moreItems.map(({ label, description, icon: Icon, tone, view }) => (
            <button
              key={label}
              className="group text-left transition active:scale-[0.985]"
              type="button"
              onClick={() => setActiveView(view)}
            >
              <Card className="h-full min-h-40 gap-0 py-0 shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md">
                <CardContent className="flex h-full flex-col justify-between p-5">
                  <span className={cn("flex size-10 items-center justify-center rounded-lg", tone)}><Icon className="size-5" /></span>
                  <span className="mt-7"><span className="block text-base font-semibold">{label}</span><span className="mt-1 block text-sm text-muted-foreground">{description}</span></span>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
        </div>
      </section>

      <PosBottomNav activeScreen="more" onNavigate={onNavigate} />
    </main>
  );
}
