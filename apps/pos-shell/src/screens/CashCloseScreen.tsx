import { ArrowLeftIcon, SaveIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@easytable/ui/components/button";
import { cn } from "@easytable/ui/lib/utils";

import { TouchNumberPad } from "../components/TouchNumberPad";
import { formatChf } from "../lib/money";
import type { DayClosePreview, PosSettingsFile, SavedDayClose } from "../lib/pos-types";

type CashCloseScreenProps = {
  onBack: () => void;
};

const fallbackCutoverTime = "00:00";

export function CashCloseScreen({ onBack }: CashCloseScreenProps) {
  const [businessDate, setBusinessDate] = useState("");
  const [cutoverTime, setCutoverTime] = useState(fallbackCutoverTime);
  const [countedCash, setCountedCash] = useState(0);
  const [preview, setPreview] = useState<DayClosePreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const cashDifference = countedCash - (preview?.expected_cash ?? 0);
  const formattedWindow = useMemo(() => {
    if (!preview) {
      return "";
    }

    const start = new Date(preview.window_start_ms).toLocaleString("de-CH", {
      dateStyle: "short",
      timeStyle: "short",
    });
    const end = new Date(preview.window_end_ms).toLocaleString("de-CH", {
      dateStyle: "short",
      timeStyle: "short",
    });

    return `${start} - ${end}`;
  }, [preview]);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialSettings() {
      try {
        const settingsFile = await invoke<PosSettingsFile>("load_pos_settings");
        const configuredCutover =
          settingsFile.settings.business_day_cutover_time || fallbackCutoverTime;
        const currentBusinessDate = await invoke<{ business_date: string }>(
          "get_current_business_date",
          {
            request: {
              business_day_cutover_time: configuredCutover,
            },
          },
        );

        if (isMounted) {
          setCutoverTime(configuredCutover);
          setBusinessDate(currentBusinessDate.business_date);
        }
      } catch (error) {
        console.warn("Could not load POS settings for day close.", error);

        if (isMounted) {
          setBusinessDate(new Date().toISOString().slice(0, 10));
        }
      }
    }

    void loadInitialSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!businessDate || !cutoverTime) {
      return;
    }

    let isMounted = true;

    async function loadPreview() {
      setIsLoadingPreview(true);
      setNotice(null);

      try {
        const loadedPreview = await invoke<DayClosePreview>(
          "get_day_close_preview",
          {
            request: {
              business_date: businessDate,
              business_day_cutover_time: cutoverTime,
            },
          },
        );

        if (isMounted) {
          setPreview(loadedPreview);
          setCountedCash(
            loadedPreview.existing_close?.counted_cash ??
              loadedPreview.expected_cash,
          );
        }
      } catch (error) {
        console.error("Could not load day close preview.", error);

        if (isMounted) {
          setPreview(null);
          setNotice("Kassenabschluss konnte nicht berechnet werden.");
        }
      } finally {
        if (isMounted) {
          setIsLoadingPreview(false);
        }
      }
    }

    void loadPreview();

    return () => {
      isMounted = false;
    };
  }, [businessDate, cutoverTime]);

  async function handleSaveDayClose() {
    if (!businessDate || !cutoverTime || isSaving) {
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      const saved = await invoke<SavedDayClose>("save_day_close", {
        request: {
          business_date: businessDate,
          business_day_cutover_time: cutoverTime,
          counted_cash: countedCash,
        },
      });

      setNotice(`Kassenabschluss ${saved.business_date} wurde gespeichert.`);
      // Future: trigger Z-Bon / Tagesabschluss receipt printing here once printer integration is wired.
      const refreshedPreview = await invoke<DayClosePreview>(
        "get_day_close_preview",
        {
          request: {
            business_date: businessDate,
            business_day_cutover_time: cutoverTime,
          },
        },
      );
      setPreview(refreshedPreview);
    } catch (error) {
      console.error("Could not save day close.", error);
      setNotice("Kassenabschluss konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-[#f7f8fc] text-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-300 bg-white px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-10 rounded-md text-slate-500"
            aria-label="Zurueck"
            onClick={onBack}
          >
            <ArrowLeftIcon className="size-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black text-slate-950">
              Kassenabschluss
            </h1>
            <p className="truncate text-xs font-black uppercase text-slate-400">
              {formattedWindow || "Geschaeftstag wird geladen"}
            </p>
          </div>
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
        <div className="mb-6 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 rounded-md bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <span className="text-xs font-black uppercase text-slate-400">
              Datum
            </span>
            <input
              className="h-12 rounded-md border border-slate-200 px-3 text-base font-black text-slate-950 outline-none focus:border-slate-400"
              type="date"
              value={businessDate}
              onChange={(event) => setBusinessDate(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 rounded-md bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <span className="text-xs font-black uppercase text-slate-400">
              Schichtende / Tageswechsel
            </span>
            <input
              className="h-12 rounded-md border border-slate-200 px-3 text-base font-black text-slate-950 outline-none focus:border-slate-400"
              type="time"
              value={cutoverTime}
              onChange={(event) => setCutoverTime(event.target.value)}
            />
          </label>
        </div>

        <div className="grid max-w-7xl grid-cols-1 items-center mx-auto xl:grid-cols-[minmax(22rem,29rem)_minmax(22rem,28rem)_minmax(20rem,1fr)]">
          <TouchNumberPad
            valueInRappen={countedCash}
            onChangeValueInRappen={setCountedCash}
            label="Gezaehltes Bargeld"
            disabled={isSaving}
          />

          <div className="grid gap-5">
            <section className="rounded-md bg-white p-5 shadow-md shadow-slate-200/70 ring-1 ring-slate-200">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase text-slate-400">
                    Systemerwartung
                  </p>
                  <p className="text-sm font-bold text-slate-500">
                    {isLoadingPreview
                      ? "Wird berechnet"
                      : "Abgeschlossene Zahlungen"}
                  </p>
                </div>
                {preview?.existing_close ? (
                  <span className="rounded-md bg-amber-50 px-3 py-2 text-xs font-black uppercase text-amber-700">
                    Bereits gespeichert
                  </span>
                ) : null}
              </div>

              <div className="grid gap-3">
                <SummaryRow label="Bargeld" value={preview?.expected_cash ?? 0} />
                <SummaryRow
                  label="Kartenzahlungen"
                  value={preview?.expected_card ?? 0}
                />
                <SummaryRow
                  label="Total"
                  value={preview?.expected_total ?? 0}
                  strong
                />
              </div>

              <div className="mt-5 grid gap-3 border-t border-slate-200 pt-5 text-sm font-bold text-slate-500 sm:grid-cols-2">
                <p>
                  Bestellungen{" "}
                  <span className="font-black text-slate-950">
                    {preview?.order_count ?? 0}
                  </span>
                </p>
                <p>
                  Produkte{" "}
                  <span className="font-black text-slate-950">
                    {preview?.item_count ?? 0}
                  </span>
                </p>
              </div>
            </section>

            <section className="rounded-md bg-white p-5 shadow-md shadow-slate-200/70 ring-1 ring-slate-200">
              <div className="mb-6 flex items-center justify-between gap-4">
                <p className="text-xl font-black text-slate-950">Differenz</p>
                <p
                  className={cn(
                    "text-3xl font-black",
                    cashDifference === 0
                      ? "text-slate-300"
                      : cashDifference > 0
                        ? "text-emerald-700"
                        : "text-rose-700",
                  )}
                >
                  {formatChf(cashDifference)}
                </p>
              </div>

              <Button
                className="h-14 w-full rounded-md bg-slate-950 text-base font-black uppercase text-white shadow-lg shadow-slate-900/10 hover:bg-slate-900"
                disabled={isSaving || isLoadingPreview || !preview}
                onClick={() => void handleSaveDayClose()}
              >
                <SaveIcon className="mr-2 size-5" />
                Abschluss speichern
              </Button>

              {notice ? (
                <p className="mt-4 rounded-md bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600">
                  {notice}
                </p>
              ) : null}
            </section>
          </div>

          <section className="rounded-md bg-white p-5 shadow-md shadow-slate-200/70 ring-1 ring-slate-200 xl:max-h-[calc(100svh-11rem)] overflow-y-auto">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase text-slate-400">
                  Verkaufte Produkte
                </p>
                <p className="text-sm font-bold text-slate-500">
                  Mengen und Umsatz
                </p>
              </div>
              <span className="text-xs font-black uppercase text-slate-400">
                {preview?.product_sales.length ?? 0} Positionen
              </span>
            </div>

            {preview?.product_sales.length ? (
              <div className="max-h-80 overflow-y-auto rounded-md border border-slate-200 xl:max-h-[calc(100svh-18rem)]">
                {preview.product_sales.map((sale) => (
                  <div
                    key={`${sale.product_id}:${sale.product_name}`}
                    className="grid grid-cols-[minmax(0,1fr)_4rem_6rem] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">
                        {sale.product_name}
                      </p>
                      <p className="truncate text-xs font-bold uppercase text-slate-400">
                        {sale.product_category}
                      </p>
                    </div>
                    <p className="text-right text-sm font-black text-slate-500">
                      {sale.quantity}x
                    </p>
                    <p className="text-right text-sm font-black text-slate-950">
                      {formatChf(sale.total)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">
                Keine verkauften Produkte im gewaehlten Zeitraum.
              </p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

type SummaryRowProps = {
  label: string;
  value: number;
  strong?: boolean;
};

function SummaryRow({ label, value, strong = false }: SummaryRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-slate-50 px-4 py-3">
      <p
        className={cn(
          "font-black",
          strong ? "text-lg text-slate-950" : "text-base text-slate-500",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "font-black text-slate-950",
          strong ? "text-xl" : "text-base",
        )}
      >
        {formatChf(value)}
      </p>
    </div>
  );
}
