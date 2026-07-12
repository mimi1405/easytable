import { ArrowLeftIcon, PrinterIcon, SaveIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@easytable/ui/components/button";
import { Badge } from "@easytable/ui/components/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@easytable/ui/components/tabs";
import { cn } from "@easytable/ui/lib/utils";
import { clearPrintLogs, createLocalDevice, getStoredTerminalConfig, loadLocalDevices, loadOutputStations, loadPosDeviceBinding, loadPrintJobs, loadPrintLogs, loadStationDeviceBindings, retryPrintJob, subscribeLocalMasterEvents, testLocalDevice, updateLocalDevice, updatePosDeviceBinding, updateStationDeviceBinding } from "../../lib/local-master-client";
import type { CatalogOutputStation, LocalDevice, LocalDeviceInput, LocalDeviceProvider, LocalDeviceType, PosDeviceBinding, PrintJob, PrintLog, StationDeviceBinding } from "../../lib/pos-types";

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

export function DeviceSettingsScreen({ onBack }: { onBack: () => void }) {
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
  const [status, setStatus] = useState("Nicht konfiguriert");

  const printerDevices = useMemo(() => devices.filter((device) => device.type === "PRINTER"), [devices]);
  const kdsDevices = useMemo(() => devices.filter((device) => device.type === "KDS_DISPLAY"), [devices]);

  const loadDevices = useCallback(async (showLoadingState = true) => {
    if (showLoadingState) {


      setIsLoading(true);
    }

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
      toast.error(caughtError instanceof Error ? caughtError.message : String(caughtError));
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
      toast.success(saved.name + " gespeichert");
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSavingDevice(false);
    }
  }

  async function runDeviceTest(device: LocalDevice) {
    setTestingDeviceId(device.id);

    try {
      const result = await testLocalDevice(device.id);

      if (result.print_log) {
        setPrintLogs((current) => prependPrintLog(current, result.print_log as PrintLog));
      }

      setStatus(result.message || device.name + " getestet");
      toast.success(result.message || device.name + " getestet");
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setTestingDeviceId(null);
    }
  }

  async function savePosBinding() {
    setSavingPosBinding(true);

    try {
      const saved = await updatePosDeviceBinding(terminalId, {
        receipt_printer_device_id: posDraft.receipt_printer_device_id || null,
        z_report_printer_device_id: posDraft.z_report_printer_device_id || null,
      });

      setPosBinding(saved);
      setPosDraft(draftFromPosBinding(saved));
      setStatus("Kassendrucker gespeichert");
      toast.success("Kassendrucker gespeichert");
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSavingPosBinding(false);
    }
  }

  async function clearPrintHistory() {
    setClearingPrintLogs(true);

    try {
      await clearPrintLogs();
      setPrintLogs([]);
      setStatus("Print-Logs geleert");
      toast.success("Print-Logs geleert");
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setClearingPrintLogs(false);
    }
  }

  async function retryFailedPrintJob(job: PrintJob) {
    setRetryingPrintJobId(job.id);

    try {
      const retriedJob = await retryPrintJob(job.id);
      setPrintJobs((current) => upsertPrintJob(current, retriedJob));
      setStatus(job.title + " wird erneut gedruckt");
      toast.info(job.title + " wird erneut gedruckt");
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setRetryingPrintJobId(null);
    }
  }



  async function saveBinding(station: CatalogOutputStation) {
    const draft = drafts[station.id] ?? draftFromBinding(bindings[station.id]);

    setSavingStationId(station.id);

    try {
      const saved = await updateStationDeviceBinding(station.id, {
        kds_device_id: station.has_kds ? draft.kds_device_id || null : null,
        printer_device_id: station.has_printer ? draft.printer_device_id || null : null,
      });

      setBindings((current) => ({ ...current, [station.id]: saved }));
      setDrafts((current) => ({ ...current, [station.id]: draftFromBinding(saved) }));
      setStatus(station.name + " gespeichert");
      toast.success(station.name + " gespeichert");
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSavingStationId(null);
    }
  }

  return (
    <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-muted/30 text-foreground">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-5">
        <Button variant="ghost" size="icon" className="size-10" onClick={onBack} aria-label="Zurück">
          <ArrowLeftIcon className="size-5" />
        </Button>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Einstellungen</p>
          <h1 className="truncate text-lg font-semibold text-foreground">Geräte & Ausgabe</h1>
        </div>
        <Badge variant="secondary" className="ml-auto hidden font-medium sm:inline-flex">{status}</Badge>
      </header>

      <section className="min-h-0 flex-1 overflow-hidden p-5 lg:p-6">
        {isLoading ? (
          <section className="rounded-md border border-slate-200 bg-white p-5 text-sm font-bold text-slate-500 shadow-sm">
            Daten werden geladen...
          </section>
        ) : (
          <Tabs defaultValue="devices" className="mx-auto h-full max-w-6xl gap-4">
            <TabsList className="grid h-10 w-full max-w-md grid-cols-3 self-center p-1">
              <TabsTrigger value="devices">Geräte</TabsTrigger>
              <TabsTrigger value="print">Druck</TabsTrigger>
              <TabsTrigger value="routing">Zuordnung</TabsTrigger>
            </TabsList>
            <TabsContent value="devices" className="min-h-0 overflow-y-auto py-1">
            <section className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-foreground/10">
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
                  <option value="browser">Browser</option>
                </select>
                <input
                  className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-indigo-500"
                  value={deviceDraft.address_or_device_id}
                  onChange={(event) => setDeviceDraft({ ...deviceDraft, address_or_device_id: event.target.value })}
                  placeholder="Geräte-ID oder Adresse"
                />
                <Button
                  className="h-11 gap-2 bg-slate-950 font-semibold text-white hover:bg-slate-800"
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
            </TabsContent>

            <TabsContent value="print" className="min-h-0 space-y-5 overflow-y-auto py-1">
            <section className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-foreground/10">
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

            <section className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-foreground/10">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase text-slate-400">Druckhistorie</p>
                  <h2 className="text-base font-black text-slate-950">Druckprotokoll</h2>
                </div>
                <Button
                  className="h-10 rounded-md font-black"
                  disabled={clearingPrintLogs || printLogs.length === 0}
                  variant="outline"
                  onClick={clearPrintHistory}
                >
                  Logs leeren
                </Button>
              </div>

              <div className="mt-4 grid gap-3">
                {printLogs.length === 0 ? (
                  <p className="rounded-md bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">
                    Keine Druckprotokolle.
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
            </TabsContent>

            <TabsContent value="routing" className="min-h-0 space-y-5 overflow-y-auto py-1">
            <section className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-foreground/10">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black uppercase text-slate-400">Diese Kasse</p>
                  <h2 className="text-base font-black text-slate-950">Kassendrucker</h2>
                  <p className="mt-1 truncate text-xs font-bold text-slate-500">Terminal {posBinding?.terminal_id ?? terminalId}</p>
                </div>
                <Button
                  className="h-10 gap-2 bg-slate-950 px-4 font-semibold text-white hover:bg-slate-800"
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

            <section className="rounded-xl bg-card p-5 shadow-sm ring-1 ring-foreground/10">
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
                            className="h-10 gap-2 bg-slate-950 px-4 font-semibold text-white hover:bg-slate-800"
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
            </TabsContent>
          </Tabs>
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
  if (status === "FAILED") return "Fehler";
  return "Wartet";
}

function printJobStatusClass(status: PrintJob["status"]) {
  if (status === "PRINTED") return "bg-emerald-100 text-emerald-700";
  if (status === "FAILED") return "bg-red-100 text-red-700";
  if (status === "PRINTING") return "bg-sky-100 text-sky-700";
  return "bg-amber-100 text-amber-700";
}
