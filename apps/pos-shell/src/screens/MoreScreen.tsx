import {
  ArrowLeftIcon,
  DoorOpenIcon,
  EllipsisIcon,
  LinkIcon,
  PrinterIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  RouterIcon,
  SaveIcon,
  SettingsIcon,
  UnlinkIcon,
  WalletCardsIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@easytable/ui/components/button";
import { cn } from "@easytable/ui/lib/utils";

import type { PosScreen } from "../App";
import {
  clearTerminalPairingConfig,
  clearPrintLogs,
  getDefaultPairingUrl,
  getLocalMasterUrl,
  getLocalMasterBlockedReason,
  getStoredTerminalConfig,
  createLocalDevice,
  loadLocalDevices,
  loadLocalMasterIdentity,
  loadOutputStations,
  loadPosDeviceBinding,
  loadPrintJobs,
  loadPosSettings,
  loadPrintLogs,
  loadStationDeviceBindings,
  pairTerminal,
  retryPrintJob,
  sendTerminalHeartbeat,
  startPairingSession,
  subscribeLocalMasterEvents,
  testLocalDevice,
  updateLocalDevice,
  updatePosDeviceBinding,
  updateStationDeviceBinding,
} from "../lib/local-master-client";
import type {
  CatalogOutputStation,
  LocalDevice,
  LocalDeviceInput,
  LocalDeviceProvider,
  LocalDeviceType,
  LocalMasterIdentity,
  PairingSession,
  PosDeviceBinding,
  PrintJob,
  PosSettingsFile,
  PrintLog,
  StationDeviceBinding,
  TerminalPairingConfig
} from "../lib/pos-types";
import { CashCloseScreen } from "./CashCloseScreen";

type MoreScreenProps = {
  onNavigate: (screen: PosScreen) => void;
};

const navItems = [
  { label: "Kasse", icon: ReceiptTextIcon, screen: "tables", active: false },
  { label: "Mehr", icon: EllipsisIcon, screen: "more", active: true },
  { label: "Abmelden", icon: DoorOpenIcon, screen: "logout", active: false },
] as const satisfies readonly {
  label: string;
  icon: typeof ReceiptTextIcon;
  screen: PosScreen;
  active: boolean;
}[];

const moreItems = [
  {
    label: "Einstellungen",
    description: "System",
    icon: SettingsIcon,
    tone: "bg-indigo-50 text-indigo-700",
    view: "local-master-settings",
  },
  {
    label: "Geräte",
    description: "KDS & Drucker",
    icon: PrinterIcon,
    tone: "bg-sky-50 text-sky-700",
    view: "devices",
  },
  {
    label: "Kassenabschluss",
    description: "Tagesabschluss",
    icon: WalletCardsIcon,
    tone: "bg-emerald-50 text-emerald-700",
    view: "cash-close",
  },
] as const;

type MoreView = "menu" | "cash-close" | "local-master-settings" | "devices";

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

  if (activeView === "local-master-settings") {
    return <LocalMasterSettingsScreen onBack={() => setActiveView("menu")} />;
  }

  if (activeView === "devices") {
    return <DeviceSettingsScreen onBack={() => setActiveView("menu")} />;
  }

  return (
    <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-[#f7f8fc] text-slate-950">
      <section className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,10rem))] gap-4">
          {moreItems.map(({ label, description, icon: Icon, tone, view }) => (
            <button
              key={label}
              className="flex aspect-square flex-col items-center justify-center rounded-md bg-white p-4 text-center shadow-md shadow-slate-200/80 ring-1 ring-slate-200 transition active:scale-[0.985] active:bg-slate-50"
              type="button"
              onClick={() => setActiveView(view)}
            >
              <span
                className={cn(
                  "mb-4 flex size-12 items-center justify-center rounded-md",
                  tone,
                )}
              >
                <Icon className="size-7" />
              </span>
              <span className="text-sm font-black text-slate-950">{label}</span>
              <span className="mt-1 text-[0.62rem] font-black uppercase text-slate-400">
                {description}
              </span>
            </button>
          ))}
        </div>

        {settingsFile ? (
          <section className="mt-8 max-w-2xl rounded-md border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-black uppercase text-slate-400">
              POS Orientierung
            </p>
            <div className="mt-3 grid gap-3 text-sm font-bold text-slate-600 sm:grid-cols-2">
              <p>
                Tenant{" "}
                <span className="font-black text-slate-950">
                  {settingsFile.settings.tenant_id}
                </span>
              </p>
              <p>
                Location{" "}
                <span className="font-black text-slate-950">
                  {settingsFile.settings.location_id}
                </span>
              </p>
              <p>
                Sprache{" "}
                <span className="font-black text-slate-950">
                  {settingsFile.settings.language}
                </span>
              </p>
              <p>
                Betrieb{" "}
                <span className="font-black text-slate-950">
                  {settingsFile.settings.service_mode === "COUNTER_SERVICE"
                    ? "Counterbetrieb"
                    : "Tischbetrieb"}
                </span>
              </p>
              <p className="truncate">
                Datei{" "}
                <span className="font-black text-slate-950">
                  {settingsFile.path}
                </span>
              </p>
            </div>
          </section>
        ) : null}
      </section>

      <footer className="grid h-16 shrink-0 grid-cols-3 border-t border-slate-200 bg-white">
        {navItems.map(({ label, icon: Icon, screen, active }) => (
          <Button
            key={label}
            variant="ghost"
            className={cn(
              "flex h-full flex-col items-center justify-center gap-0.5 rounded-none text-xs font-black uppercase transition active:bg-slate-100",
              active ? "text-indigo-800" : "text-slate-500",
            )}
            onClick={() => onNavigate(screen)}
          >
            <Icon className="size-5" />
            {label}
          </Button>
        ))}
      </footer>
    </main>
  );
}

function LocalMasterSettingsScreen({ onBack }: { onBack: () => void }) {
  const [endpoint, setEndpoint] = useState(getDefaultPairingUrl());
  const [terminalName, setTerminalName] = useState("Kasse 1");
  const [pairingCode, setPairingCode] = useState("");
  const [identity, setIdentity] = useState<LocalMasterIdentity | null>(null);
  const [pairingSession, setPairingSession] = useState<PairingSession | null>(null);
  const [terminalConfig, setTerminalConfig] = useState<TerminalPairingConfig | null>(getStoredTerminalConfig());
  const [status, setStatus] = useState(getLocalMasterBlockedReason() ?? "Bereit");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const pairingPayload = useMemo(() => {
    if (!pairingSession) {
      return "";
    }

    return JSON.stringify({
      type: "easytable-local-master-pairing",
      url: endpoint,
      code: pairingSession.code,
      instanceId: pairingSession.instance_id,
      expiresAt: pairingSession.expires_at,
    });
  }, [endpoint, pairingSession]);
  async function runAction(action: () => Promise<void>) {
    setIsBusy(true);
    setError(null);

    try {
      await action();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setIsBusy(false);
    }
  }

  function updateTerminalConfig(config: TerminalPairingConfig | null) {
    setTerminalConfig(config);
  }

  return (
    <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-[#f7f8fc] text-slate-950">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <Button variant="ghost" className="size-11 p-0" onClick={onBack}>
          <ArrowLeftIcon className="size-5" />
        </Button>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-slate-400">Einstellungen</p>
          <h1 className="truncate text-lg font-black text-slate-950">LocalMaster</h1>
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
        <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
          <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-700">
                <RouterIcon className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black uppercase text-slate-400">Verbindung</p>
                <p className="mt-1 truncate text-sm font-black text-slate-950">{getLocalMasterUrl()}</p>
                <p className="mt-2 text-sm font-bold text-slate-500">{status}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <label className="grid gap-1 text-xs font-black uppercase text-slate-400">
                LocalMaster URL
                <input
                  className="h-12 rounded-md border border-slate-200 px-3 text-base font-bold normal-case text-slate-950 outline-none focus:border-indigo-500"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="http://192.168.1.20:3000"
                />
              </label>
              <label className="grid gap-1 text-xs font-black uppercase text-slate-400">
                Terminal
                <input
                  className="h-12 rounded-md border border-slate-200 px-3 text-base font-bold normal-case text-slate-950 outline-none focus:border-indigo-500"
                  value={terminalName}
                  onChange={(event) => setTerminalName(event.target.value)}
                  placeholder="Kasse 1"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Button
                className="h-12 gap-2 rounded-md font-black"
                disabled={isBusy}
                onClick={() =>
                  runAction(async () => {
                    const loadedIdentity = await loadLocalMasterIdentity(endpoint);
                    setIdentity(loadedIdentity);

                    if (
                      terminalConfig &&
                      terminalConfig.localMasterInstanceId !== loadedIdentity.instance_id
                    ) {
                      setStatus("Andere LocalMaster Instanz erkannt. Neu koppeln erforderlich.");
                      return;
                    }

                    setStatus("Verbindung aktiv");
                  })
                }
              >
                <RefreshCwIcon className="size-4" />
                Testen
              </Button>
              <Button
                className="h-12 gap-2 rounded-md bg-slate-950 font-black text-white hover:bg-slate-800"
                disabled={isBusy}
                onClick={() =>
                  runAction(async () => {
                    const session = await startPairingSession({ local_master_url: endpoint }, endpoint);
                    setPairingSession(session);
                    setPairingCode(session.code);
                    setStatus("Pairing-Code aktiv bis " + new Date(session.expires_at).toLocaleTimeString("de-CH"));
                  })
                }
              >
                <LinkIcon className="size-4" />
                Code erzeugen
              </Button>
              <Button
                className="h-12 gap-2 rounded-md font-black"
                disabled={isBusy || !terminalConfig}
                variant="outline"
                onClick={() =>
                  runAction(async () => {
                    await sendTerminalHeartbeat();
                    const updatedConfig = getStoredTerminalConfig();
                    updateTerminalConfig(updatedConfig);
                    setStatus("Terminal Heartbeat gesendet");
                  })
                }
              >
                <RefreshCwIcon className="size-4" />
                Heartbeat
              </Button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_9rem]">
              <label className="grid gap-1 text-xs font-black uppercase text-slate-400">
                Code
                <input
                  className="h-12 rounded-md border border-slate-200 px-3 text-center text-xl font-black tracking-[0.2em] text-slate-950 outline-none focus:border-indigo-500"
                  value={pairingCode}
                  onChange={(event) => setPairingCode(event.target.value)}
                  placeholder="000000"
                />
              </label>
              <div className="grid gap-1 text-xs font-black uppercase text-slate-400">
                Pairing Payload
                <div className="flex h-12 items-center overflow-hidden rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-bold normal-case text-slate-500">
                  <span className="truncate">{pairingPayload || "Code erzeugen oder Code vom Master-PC eingeben"}</span>
                </div>
              </div>
              <Button
                className="mt-5 h-12 rounded-md bg-indigo-700 font-black text-white hover:bg-indigo-800"
                disabled={isBusy || pairingCode.trim().length === 0}
                onClick={() =>
                  runAction(async () => {
                    const config = await pairTerminal(endpoint, {
                      code: pairingCode,
                      terminal_name: terminalName,
                      role: endpoint.includes("localhost") ? "MASTER_POS" : "POS_TERMINAL",
                    });
                    updateTerminalConfig(config);
                    setStatus("Terminal gekoppelt");
                  })
                }
              >
                Koppeln
              </Button>
            </div>
{error ? (
              <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                {error}
              </p>
            ) : null}
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase text-slate-400">Status</p>
            <div className="mt-4 grid gap-3 text-sm font-bold text-slate-600">
              <StatusRow label="Service" value={identity?.service ?? "Nicht getestet"} />
              <StatusRow label="Instance" value={identity?.instance_id ?? terminalConfig?.localMasterInstanceId ?? "-"} />
              <StatusRow label="Location" value={identity?.location_id ?? "-"} />
              <StatusRow label="Port" value={identity?.port ? String(identity.port) : "-"} />
              <StatusRow label="Terminal" value={terminalConfig?.terminalName ?? "Nicht gekoppelt"} />
              <StatusRow label="Terminal-ID" value={terminalConfig?.terminalId ?? "-"} />
              <StatusRow
                label="Zuletzt gesehen"
                value={terminalConfig ? new Date(terminalConfig.lastSeenAt).toLocaleString("de-CH") : "-"}
              />
            </div>

            <Button
              className="mt-5 h-11 w-full gap-2 rounded-md font-black"
              disabled={isBusy || !terminalConfig}
              variant="outline"
              onClick={() =>
                runAction(async () => {
                  await clearTerminalPairingConfig();
                  updateTerminalConfig(null);
                  setStatus("Terminal-Kopplung entfernt");
                })
              }
            >
              <UnlinkIcon className="size-4" />
              Neu koppeln
            </Button>
          </section>
        </div>
      </section>
    </main>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-slate-50 px-3 py-2">
      <p className="text-[0.65rem] font-black uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 truncate font-black text-slate-950">{value}</p>
    </div>
  );
}

type DeviceDraft = {
  kds_device_id: string;
  printer_device_id: string;
};

type LocalDeviceDraft = {
  id: string | null;
  name: string;
  type: LocalDeviceType;
  provider: LocalDeviceProvider;
  address_or_device_id: string;
};

type PosDeviceDraft = {
  receipt_printer_device_id: string;
  z_report_printer_device_id: string;
};

const emptyLocalDeviceDraft: LocalDeviceDraft = {
  id: null,
  name: "",
  type: "PRINTER",
  provider: "manual",
  address_or_device_id: "",
};

function DeviceSettingsScreen({ onBack }: { onBack: () => void }) {
  const terminalId = getStoredTerminalConfig()?.terminalId ?? "pos-shell";
  const [stations, setStations] = useState<CatalogOutputStation[]>([]);
  const [devices, setDevices] = useState<LocalDevice[]>([]);
  const [printLogs, setPrintLogs] = useState<PrintLog[]>([]);
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);
  const [bindings, setBindings] = useState<Record<string, StationDeviceBinding>>({});
  const [posBinding, setPosBinding] = useState<PosDeviceBinding | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DeviceDraft>>({});
  const [posDraft, setPosDraft] = useState<PosDeviceDraft>({
    receipt_printer_device_id: "",
    z_report_printer_device_id: "",
  });
  const [deviceDraft, setDeviceDraft] = useState<LocalDeviceDraft>(emptyLocalDeviceDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [savingStationId, setSavingStationId] = useState<string | null>(null);
  const [savingDevice, setSavingDevice] = useState(false);
  const [savingPosBinding, setSavingPosBinding] = useState(false);
  const [clearingPrintLogs, setClearingPrintLogs] = useState(false);
  const [testingDeviceId, setTestingDeviceId] = useState<string | null>(null);
  const [retryingPrintJobId, setRetryingPrintJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Nicht konfiguriert");

  const printerDevices = useMemo(() => devices.filter((device) => device.type === "PRINTER"), [devices]);
  const kdsDevices = useMemo(() => devices.filter((device) => device.type === "KDS_DISPLAY"), [devices]);

  const loadDevices = useCallback(async (showLoadingState = true) => {
    if (showLoadingState) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const [loadedStations, loadedBindings, loadedDevices, loadedPosBinding, loadedPrintLogs, loadedPrintJobs] = await Promise.all([
        loadOutputStations(),
        loadStationDeviceBindings(),
        loadLocalDevices(),
        loadPosDeviceBinding(terminalId),
        loadPrintLogs(),
        loadPrintJobs(),
      ]);
      const activeStations = loadedStations
        .filter((station) => station.is_active)
        .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
      const bindingsByStation = Object.fromEntries(
        loadedBindings.map((binding) => [binding.station_id, binding]),
      );

      setStations(activeStations);
      setDevices(loadedDevices);
      setPrintLogs(loadedPrintLogs);
      setPrintJobs(loadedPrintJobs);
      setBindings(bindingsByStation);
      setPosBinding(loadedPosBinding);
      setPosDraft(draftFromPosBinding(loadedPosBinding));
      setDrafts(
        Object.fromEntries(
          activeStations.map((station) => [
            station.id,
            draftFromBinding(bindingsByStation[station.id]),
          ]),
        ),
      );
      setStatus(activeStations.length === 0 ? "Keine Stationen konfiguriert" : "Bereit");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      setStatus("Fehler beim Laden");
    } finally {
      if (showLoadingState) {
        setIsLoading(false);
      }
    }
  }, [terminalId]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    return subscribeLocalMasterEvents((event) => {
      if (event.type === "DEVICE_CONFIG_UPDATED") {
        void loadDevices(false);
        return;
      }

      if (event.type === "PRINT_JOB_CREATED" || event.type === "PRINT_JOB_UPDATED") {
        const printJob = printJobFromEventPayload(event.payload);

        if (printJob?.id) {
          setPrintJobs((current) => upsertPrintJob(current, printJob));
        }

        return;
      }

      if (event.type !== "PRINT_LOG_CREATED") {
        return;
      }

      const log = event.payload as PrintLog | undefined;

      if (!log?.id) {
        return;
      }

      setPrintLogs((current) => prependPrintLog(current, log));
    });
  }, [loadDevices]);

  function updateDraft(stationId: string, patch: Partial<DeviceDraft>) {
    setDrafts((current) => ({
      ...current,
      [stationId]: {
        ...draftFromBinding(bindings[stationId]),
        ...current[stationId],
        ...patch,
      },
    }));
  }

  function editDevice(device: LocalDevice) {
    setDeviceDraft({
      id: device.id,
      name: device.name,
      type: device.type,
      provider: device.provider,
      address_or_device_id: device.address_or_device_id ?? "",
    });
  }

  async function saveDevice() {
    const input: LocalDeviceInput = {
      name: deviceDraft.name,
      type: deviceDraft.type,
      provider: deviceDraft.provider,
      address_or_device_id: deviceDraft.address_or_device_id,
    };

    setSavingDevice(true);
    setError(null);

    try {
      const saved = deviceDraft.id
        ? await updateLocalDevice(deviceDraft.id, input)
        : await createLocalDevice(input);

      setDevices((current) => {
        const withoutSaved = current.filter((device) => device.id !== saved.id);
        return [...withoutSaved, saved].sort(
          (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name),
        );
      });
      setDeviceDraft(emptyLocalDeviceDraft);
      setStatus(saved.name + " gespeichert");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSavingDevice(false);
    }
  }

  async function runDeviceTest(device: LocalDevice) {
    setTestingDeviceId(device.id);
    setError(null);

    try {
      const result = await testLocalDevice(device.id);

      if (result.print_log) {
        setPrintLogs((current) => prependPrintLog(current, result.print_log as PrintLog));
      }

      setStatus(result.message || device.name + " getestet");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setTestingDeviceId(null);
    }
  }

  async function savePosBinding() {
    setSavingPosBinding(true);
    setError(null);

    try {
      const saved = await updatePosDeviceBinding(terminalId, {
        receipt_printer_device_id: posDraft.receipt_printer_device_id || null,
        z_report_printer_device_id: posDraft.z_report_printer_device_id || null,
      });

      setPosBinding(saved);
      setPosDraft(draftFromPosBinding(saved));
      setStatus("Kassendrucker gespeichert");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSavingPosBinding(false);
    }
  }

  async function clearSimulatorLogs() {
    setClearingPrintLogs(true);
    setError(null);

    try {
      await clearPrintLogs();
      setPrintLogs([]);
      setStatus("Print-Logs geleert");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setClearingPrintLogs(false);
    }
  }

  async function retryFailedPrintJob(job: PrintJob) {
    setRetryingPrintJobId(job.id);
    setError(null);

    try {
      const retriedJob = await retryPrintJob(job.id);
      setPrintJobs((current) => upsertPrintJob(current, retriedJob));
      setStatus(job.title + " wird erneut gedruckt");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setRetryingPrintJobId(null);
    }
  }

  async function saveBinding(station: CatalogOutputStation) {
    const draft = drafts[station.id] ?? draftFromBinding(bindings[station.id]);

    setSavingStationId(station.id);
    setError(null);

    try {
      const saved = await updateStationDeviceBinding(station.id, {
        kds_device_id: station.has_kds ? draft.kds_device_id || null : null,
        printer_device_id: station.has_printer ? draft.printer_device_id || null : null,
      });

      setBindings((current) => ({ ...current, [station.id]: saved }));
      setDrafts((current) => ({ ...current, [station.id]: draftFromBinding(saved) }));
      setStatus(station.name + " gespeichert");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSavingStationId(null);
    }
  }

  return (
    <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-[#f7f8fc] text-slate-950">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <Button variant="ghost" className="size-11 p-0" onClick={onBack}>
          <ArrowLeftIcon className="size-5" />
        </Button>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase text-slate-400">Einstellungen</p>
          <h1 className="truncate text-lg font-black text-slate-950">Geräte</h1>
        </div>
        <p className="ml-auto hidden text-sm font-bold text-slate-500 sm:block">{status}</p>
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
        {error ? (
          <p className="mb-4 max-w-5xl rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <section className="rounded-md border border-slate-200 bg-white p-5 text-sm font-bold text-slate-500 shadow-sm">
            Daten werden geladen...
          </section>
        ) : (
          <div className="grid max-w-6xl gap-5">
            <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-700">
                  <PrinterIcon className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase text-slate-400">Lokale Geräte</p>
                  <h2 className="text-base font-black text-slate-950">Geräte erfassen</h2>
                </div>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_minmax(0,1fr)_8rem]">
                <input
                  className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                  value={deviceDraft.name}
                  onChange={(event) => setDeviceDraft({ ...deviceDraft, name: event.target.value })}
                  placeholder="Name, z.B. Drucker A"
                />
                <select
                  className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                  value={deviceDraft.type}
                  onChange={(event) => setDeviceDraft({ ...deviceDraft, type: event.target.value as LocalDeviceType })}
                >
                  <option value="PRINTER">Bondrucker</option>
                  <option value="KDS_DISPLAY">KDS</option>
                </select>
                <select
                  className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                  value={deviceDraft.provider}
                  onChange={(event) =>
                    setDeviceDraft({ ...deviceDraft, provider: event.target.value as LocalDeviceProvider })
                  }
                >
                  <option value="manual">Manuell</option>
                  <option value="windows">Windows</option>
                  <option value="escpos">ESC/POS</option>
                  <option value="simulator">Simulator</option>
                  <option value="browser">Browser</option>
                </select>
                <input
                  className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                  value={deviceDraft.address_or_device_id}
                  onChange={(event) => setDeviceDraft({ ...deviceDraft, address_or_device_id: event.target.value })}
                  placeholder="Geräte-ID oder Adresse"
                />
                <Button
                  className="h-11 gap-2 rounded-md bg-indigo-700 font-black text-white hover:bg-indigo-800"
                  disabled={savingDevice}
                  onClick={saveDevice}
                >
                  <SaveIcon className="size-4" />
                  {deviceDraft.id ? "Update" : "Neu"}
                </Button>
              </div>

              {deviceDraft.id ? (
                <Button
                  className="mt-3 h-10 rounded-md font-black"
                  variant="outline"
                  onClick={() => setDeviceDraft(emptyLocalDeviceDraft)}
                >
                  Neu erfassen
                </Button>
              ) : null}

              <div className="mt-5 grid gap-3">
                {devices.length === 0 ? (
                  <p className="rounded-md bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">
                    Keine lokalen GerÃ¤te erfasst.
                  </p>
                ) : (
                  devices.map((device) => (
                    <div
                      key={device.id}
                      className="grid gap-3 rounded-md border border-slate-200 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_8rem_7rem]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-950">{device.name}</p>
                        <p className="truncate text-xs font-bold text-slate-500">
                          {device.address_or_device_id || "Keine Geräte-ID"}
                        </p>
                      </div>
                      <span className="rounded bg-slate-50 px-2 py-2 text-center text-xs font-black uppercase text-slate-600">
                        {device.type === "PRINTER" ? "Bon" : "KDS"}
                      </span>
                      <span className="rounded bg-slate-50 px-2 py-2 text-center text-xs font-black uppercase text-slate-600">
                        {device.provider}
                      </span>
                      <Button
                        className="h-10 rounded-md font-black"
                        disabled={testingDeviceId === device.id}
                        variant="outline"
                        onClick={() => runDeviceTest(device)}
                      >
                        {device.type === "PRINTER" ? "Testdruck" : "KDS-Test"}
                      </Button>
                      <Button className="h-10 rounded-md font-black" variant="outline" onClick={() => editDevice(device)}>
                        Bearbeiten
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase text-slate-400">Print-Jobs</p>
                  <h2 className="text-base font-black text-slate-950">Druckaufträge</h2>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {printJobs.length === 0 ? (
                  <p className="rounded-md bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">
                    Keine Druckaufträge.
                  </p>
                ) : (
                  printJobs.slice(0, 30).map((job) => (
                    <div key={job.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-slate-950">{job.title}</p>
                          <p className="mt-1 truncate text-xs font-bold text-slate-500">
                            {job.device_name} {job.station_name ? "· " + job.station_name : ""}
                          </p>
                        </div>
                        <span className="rounded bg-white px-2 py-1 text-xs font-black uppercase text-slate-600">
                          {formatPrintLogSource(job.source)}
                        </span>
                        <span className={cn("rounded px-2 py-1 text-xs font-black uppercase", printJobStatusClass(job.status))}>
                          {formatPrintJobStatus(job.status)}
                        </span>
                        {job.status === "FAILED" ? (
                          <Button
                            className="h-8 rounded-md px-3 text-xs font-black"
                            disabled={retryingPrintJobId === job.id}
                            variant="outline"
                            onClick={() => retryFailedPrintJob(job)}
                          >
                            Erneut
                          </Button>
                        ) : null}
                      </div>
                      {job.error ? (
                        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                          {job.error}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs font-bold text-slate-400">
                        Versuche: {job.attempt_count ?? 0}
                        {job.last_attempt_at ? " · " + new Date(job.last_attempt_at).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : ""}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase text-slate-400">Print-Simulator</p>
                  <h2 className="text-base font-black text-slate-950">Simulierte Drucke</h2>
                </div>
                <Button
                  className="h-10 rounded-md font-black"
                  disabled={clearingPrintLogs || printLogs.length === 0}
                  variant="outline"
                  onClick={clearSimulatorLogs}
                >
                  Logs leeren
                </Button>
              </div>

              <div className="mt-4 grid gap-3">
                {printLogs.length === 0 ? (
                  <p className="rounded-md bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">
                    Keine simulierten Drucke.
                  </p>
                ) : (
                  printLogs.slice(0, 20).map((log) => (
                    <div key={log.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-slate-950">{log.title}</p>
                          <p className="mt-1 truncate text-xs font-bold text-slate-500">{log.device_name}</p>
                        </div>
                        <span className="rounded bg-white px-2 py-1 text-xs font-black uppercase text-slate-600">
                          {formatPrintLogSource(log.source)}
                        </span>
                        <span className="text-xs font-bold text-slate-400">
                          {new Date(log.created_at).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <pre className="mt-3 whitespace-pre-wrap rounded-md bg-white px-3 py-2 text-xs font-bold text-slate-600">
                        {log.body}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase text-slate-400">Diese Kasse</p>
                  <h2 className="text-base font-black text-slate-950">Kassendrucker</h2>
                  <p className="mt-1 truncate text-xs font-bold text-slate-500">Terminal {posBinding?.terminal_id ?? terminalId}</p>
                </div>
                <Button
                  className="h-10 gap-2 rounded-md bg-indigo-700 px-4 font-black text-white hover:bg-indigo-800"
                  disabled={savingPosBinding}
                  onClick={savePosBinding}
                >
                  <SaveIcon className="size-4" />
                  Speichern
                </Button>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <label className="grid gap-1 text-xs font-black uppercase text-slate-400">
                  Belegdrucker dieser Kasse
                  <select
                    className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold normal-case text-slate-950 outline-none focus:border-indigo-500"
                    value={posDraft.receipt_printer_device_id}
                    onChange={(event) => setPosDraft({ ...posDraft, receipt_printer_device_id: event.target.value })}
                  >
                    <option value="">Nicht konfiguriert</option>
                    {printerDevices.map((device) => (
                      <option key={device.id} value={device.id}>{device.name}</option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-xs font-black uppercase text-slate-400">
                  Z-Bon-Drucker dieser Kasse
                  <select
                    className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold normal-case text-slate-950 outline-none focus:border-indigo-500"
                    value={posDraft.z_report_printer_device_id}
                    onChange={(event) => setPosDraft({ ...posDraft, z_report_printer_device_id: event.target.value })}
                  >
                    <option value="">Nicht konfiguriert</option>
                    {printerDevices.map((device) => (
                      <option key={device.id} value={device.id}>{device.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase text-slate-400">Stationsausgabe</p>
              {stations.length === 0 ? (
                <p className="mt-3 rounded-md bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">
                  Keine Stationen konfiguriert.
                </p>
              ) : (
                <div className="mt-4 grid gap-4">
                  {stations.map((station) => {
                    const draft = drafts[station.id] ?? draftFromBinding(bindings[station.id]);
                    const isSaving = savingStationId === station.id;

                    return (
                      <section key={station.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-base font-black text-slate-950">{station.name}</h3>
                            <div className="mt-2 flex flex-wrap gap-2 text-[0.65rem] font-black uppercase">
                              {station.has_kds ? <span className="rounded bg-sky-100 px-2 py-1 text-sky-700">KDS</span> : null}
                              {station.has_printer ? <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700">Bon</span> : null}
                              {!station.has_kds && !station.has_printer ? (
                                <span className="rounded bg-white px-2 py-1 text-slate-500">Keine Ausgabe</span>
                              ) : null}
                            </div>
                          </div>
                          <Button
                            className="h-10 gap-2 rounded-md bg-indigo-700 px-4 font-black text-white hover:bg-indigo-800"
                            disabled={isSaving}
                            onClick={() => saveBinding(station)}
                          >
                            <SaveIcon className="size-4" />
                            Speichern
                          </Button>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                          {station.has_kds ? (
                            <label className="grid gap-1 text-xs font-black uppercase text-slate-400">
                              KDS-GerÃ¤t
                              <select
                                className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold normal-case text-slate-950 outline-none focus:border-indigo-500"
                                value={draft.kds_device_id}
                                onChange={(event) => updateDraft(station.id, { kds_device_id: event.target.value })}
                              >
                                <option value="">Nicht konfiguriert</option>
                                {kdsDevices.map((device) => (
                                  <option key={device.id} value={device.id}>{device.name}</option>
                                ))}
                              </select>
                            </label>
                          ) : null}

                          {station.has_printer ? (
                            <label className="grid gap-1 text-xs font-black uppercase text-slate-400">
                              Stations-Bondrucker
                              <select
                                className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold normal-case text-slate-950 outline-none focus:border-indigo-500"
                                value={draft.printer_device_id}
                                onChange={(event) => updateDraft(station.id, { printer_device_id: event.target.value })}
                              >
                                <option value="">Nicht konfiguriert</option>
                                {printerDevices.map((device) => (
                                  <option key={device.id} value={device.id}>{device.name}</option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function draftFromBinding(binding: StationDeviceBinding | undefined): DeviceDraft {
  return {
    kds_device_id: binding?.kds_device_id ?? "",
    printer_device_id: binding?.printer_device_id ?? "",
  };
}

function draftFromPosBinding(binding: PosDeviceBinding): PosDeviceDraft {
  return {
    receipt_printer_device_id: binding.receipt_printer_device_id ?? "",
    z_report_printer_device_id: binding.z_report_printer_device_id ?? "",
  };
}

function prependPrintLog(current: PrintLog[], log: PrintLog) {
  return [log, ...current.filter((entry) => entry.id !== log.id)];
}

function upsertPrintJob(current: PrintJob[], job: PrintJob) {
  return [job, ...current.filter((entry) => entry.id !== job.id)].sort(
    (left, right) => right.created_at - left.created_at,
  );
}

function printJobFromEventPayload(payload: unknown): PrintJob | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if ("job" in payload) {
    const wrapped = payload as { job?: unknown };
    return printJobFromEventPayload(wrapped.job);
  }

  if ("id" in payload) {
    return payload as PrintJob;
  }

  return null;
}

function formatPrintLogSource(source: PrintLog["source"]) {
  if (source === "STATION") return "Stationsbon";
  if (source === "RECEIPT") return "Beleg";
  if (source === "Z_REPORT") return "Z-Bon";
  return "Test";
}

function formatPrintJobStatus(status: PrintJob["status"]) {
  if (status === "PRINTING") return "Druckt";
  if (status === "PRINTED") return "Gedruckt";
  if (status === "SIMULATED") return "Simuliert";
  if (status === "FAILED") return "Fehler";
  return "Wartet";
}

function printJobStatusClass(status: PrintJob["status"]) {
  if (status === "PRINTED" || status === "SIMULATED") return "bg-emerald-100 text-emerald-700";
  if (status === "FAILED") return "bg-red-100 text-red-700";
  if (status === "PRINTING") return "bg-sky-100 text-sky-700";
  return "bg-amber-100 text-amber-700";
}

