import { BellIcon, CheckIcon, ClockIcon, PackageCheckIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import { Card, CardContent } from "@easytable/ui/components/card";

import {
  acknowledgeStationPickupForConnection,
  detectConnectionMode,
  loadStationPickupsForConnection,
  subscribeLocalMasterEvents,
  type ConnectionMode,
  type StationPickup,
} from "../../lib/local-master";

const pickupReloadEvents = new Set(["STATION_PICKUP_READY", "STATION_PICKUP_ACKNOWLEDGED"]);

export function StaffPickupsScreen() {
  const [pickups, setPickups] = useState<StationPickup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmittingPickupId, setIsSubmittingPickupId] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("OFFLINE");

  const loadPickups = useCallback(async (showLoadingState = true) => {
    if (showLoadingState) {
      setIsLoading(true);
    }

    try {
      const mode = await detectConnectionMode();
      setConnectionMode(mode);

      if (mode === "OFFLINE") {
        setPickups([]);
        setNotice("Keine Verbindung zu LocalMaster oder Relay.");
        return;
      }

      setPickups(await loadStationPickupsForConnection(mode, "READY"));
      setNotice(null);
    } catch (error) {
      console.warn("Could not load station pickups.", error);
      setNotice("Abholungen konnten nicht geladen werden.");
    } finally {
      if (showLoadingState) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadPickups();
  }, [loadPickups]);

  useEffect(() => {
    if (connectionMode !== "LOCAL") {
      return undefined;
    }

    return subscribeLocalMasterEvents((event) => {
      if (!pickupReloadEvents.has(event.type)) {
        return;
      }

      if (event.type === "STATION_PICKUP_READY") {
        setNotice("Neue Abholung bereit.");
      }

      void loadPickups(false);
    });
  }, [connectionMode, loadPickups]);

  useEffect(() => {
    if (connectionMode !== "RELAY") {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void loadPickups(false);
    }, 3_000);

    return () => window.clearInterval(timer);
  }, [connectionMode, loadPickups]);

  const itemCount = useMemo(
    () => pickups.reduce((total, pickup) => total + pickup.items.reduce((sum, item) => sum + item.quantity, 0), 0),
    [pickups],
  );

  async function handleAcknowledge(pickup: StationPickup) {
    if (isSubmittingPickupId) {
      return;
    }

    setIsSubmittingPickupId(pickup.id);
    setNotice(null);

    try {
      await acknowledgeStationPickupForConnection(connectionMode, pickup.id);
      setPickups((current) => current.filter((entry) => entry.id !== pickup.id));
      setNotice(`${pickup.station} · Tisch ${pickup.table_name} abgeholt.`);
    } catch (error) {
      console.error("Could not acknowledge station pickup.", error);
      setNotice(error instanceof Error ? error.message : "Abholung konnte nicht bestätigt werden.");
    } finally {
      setIsSubmittingPickupId(null);
    }
  }

  return (
    <section className="mx-auto flex h-[calc(100svh-6.5rem)] max-w-5xl touch-manipulation flex-col overflow-hidden rounded-md border bg-[#f7f8fc] text-slate-950 shadow-sm">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-800">
              <BellIcon className="size-6" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-black text-slate-950">Abholungen</h2>
              <p className="truncate text-xs font-bold uppercase text-slate-400">Bereite Station-Bestellungen</p>
            </div>
          </div>
          <Badge className="shrink-0 bg-slate-950 px-3 py-1.5 text-sm font-black text-white hover:bg-slate-950">
            {pickups.length} · {itemCount}
          </Badge>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
        {pickups.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {pickups.map((pickup) => (
              <Card key={pickup.id} className="overflow-hidden rounded-md bg-white py-0 shadow-md shadow-slate-200/80 ring-1 ring-slate-200">
                <CardContent className="p-0">
                  <div className="border-b border-slate-100 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-black text-slate-950">
                          {pickup.station} · Tisch {pickup.table_name}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400">
                          <ClockIcon className="size-3.5" />
                          {formatReadyAge(pickup.ready_at)}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0 bg-amber-50 text-xs font-black uppercase text-amber-700">
                        Bereit
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-3 p-4">
                    {pickup.items.map((item) => (
                      <div key={`${pickup.id}:${item.product_id}:${item.product_name}`} className="flex items-start gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-sm font-black text-slate-700">
                          {item.quantity}x
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-slate-950">{item.product_name}</p>
                          {item.variants.length > 0 ? (
                            <p className="mt-0.5 truncate text-xs font-bold text-slate-500">
                              {item.variants.map((variant) => variant.variant_item_name).join(", ")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button
                    className="h-14 w-full rounded-none bg-emerald-300 text-base font-black uppercase text-emerald-900 transition hover:bg-emerald-300 active:bg-emerald-400 disabled:bg-slate-200 disabled:text-slate-400"
                    disabled={isSubmittingPickupId !== null}
                    onClick={() => void handleAcknowledge(pickup)}
                  >
                    <CheckIcon className="size-5" />
                    {isSubmittingPickupId === pickup.id ? "Speichern..." : "Abgeholt"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[48svh] items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/60 px-6 text-center">
            <div className="max-w-sm">
              <PackageCheckIcon className="mx-auto mb-4 size-14 text-slate-300" />
              <p className="text-sm font-black uppercase text-slate-400">
                {isLoading ? "Abholungen werden geladen" : "Keine Abholungen bereit"}
              </p>
            </div>
          </div>
        )}
      </div>

      {notice ? (
        <div className="fixed bottom-6 left-4 right-4 z-40 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-lg shadow-slate-900/10 sm:right-auto sm:max-w-sm">
          {notice}
        </div>
      ) : null}
    </section>
  );
}

function formatReadyAge(readyAt: number) {
  const ageInSeconds = Math.max(0, Math.floor((Date.now() - readyAt) / 1000));

  if (ageInSeconds < 60) {
    return "gerade bereit";
  }

  const ageInMinutes = Math.floor(ageInSeconds / 60);

  if (ageInMinutes === 1) {
    return "seit 1 Minute bereit";
  }

  return `seit ${ageInMinutes} Minuten bereit`;
}
