import { ArrowLeftIcon, CloudIcon, LinkIcon, RefreshCwIcon, RouterIcon, UnlinkIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@easytable/ui/components/button";
import { Badge } from "@easytable/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@easytable/ui/components/card";
import { Input } from "@easytable/ui/components/input";
import { Label } from "@easytable/ui/components/label";
import { Separator } from "@easytable/ui/components/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@easytable/ui/components/tabs";
import { clearTerminalPairingConfig, getDefaultPairingUrl, getLocalMasterBlockedReason, getLocalMasterUrl, getStoredTerminalConfig, loadCloudBinding, loadLocalMasterIdentity, pairCloudRelay, pairTerminal, retryCloudBootstrap, sendTerminalHeartbeat, startPairingSession } from "../../lib/local-master-client";
import type { CloudBinding, LocalMasterIdentity, PairingSession, PosSettingsFile, TerminalPairingConfig } from "../../lib/pos-types";
import { checkForPosUpdate } from "../../lib/updater";

export function LocalMasterSettingsScreen({ settingsFile, onBack }: { settingsFile: PosSettingsFile | null; onBack: () => void }) {
  const [endpoint, setEndpoint] = useState(getDefaultPairingUrl());
  const [terminalName, setTerminalName] = useState("Kasse 1");
  const [pairingCode, setPairingCode] = useState("");
  const [relayBaseUrl, setRelayBaseUrl] = useState("http://localhost:3100");
  const [setupCode, setSetupCode] = useState("");
  const [identity, setIdentity] = useState<LocalMasterIdentity | null>(null);
  const [cloudBinding, setCloudBinding] = useState<CloudBinding | null>(null);
  const [pairingSession, setPairingSession] = useState<PairingSession | null>(null);
  const [terminalConfig, setTerminalConfig] = useState<TerminalPairingConfig | null>(getStoredTerminalConfig());
  const [status, setStatus] = useState(getLocalMasterBlockedReason() ?? "Bereit");
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

    try {
      await action();
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setIsBusy(false);
    }
  }

  function updateTerminalConfig(config: TerminalPairingConfig | null) {
    setTerminalConfig(config);
  }

  async function refreshCloudBinding() {
    const binding = await loadCloudBinding(endpoint);
    setCloudBinding(binding);
    return binding;
  }

  return (
    <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-muted/30 text-foreground">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-5">
        <Button variant="ghost" size="icon" className="size-10" onClick={onBack} aria-label="Zurück">
          <ArrowLeftIcon className="size-5" />
        </Button>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Einstellungen</p>
          <h1 className="truncate text-lg font-semibold">LocalMaster & Geräte</h1>
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-hidden p-5 lg:p-6">
        <Tabs defaultValue="connection" className="mx-auto h-full max-w-5xl gap-4">
          <TabsList className="grid h-10 w-full max-w-xl grid-cols-4 self-center p-1">
            <TabsTrigger value="connection">Verbindung</TabsTrigger>
            <TabsTrigger value="cloud">Cloud</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
            <TabsTrigger value="info">POS-Info</TabsTrigger>
          </TabsList>
          <TabsContent value="connection" className="min-h-0 overflow-y-auto py-1">
          <Card className="gap-0 py-0 shadow-sm">
            <CardHeader className="border-b py-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white">
                <RouterIcon className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle>Lokale Verbindung</CardTitle>
                <CardDescription className="mt-1 truncate">{getLocalMasterUrl()}</CardDescription>
                <Badge variant="secondary" className="mt-3 font-medium">{status}</Badge>
              </div>
            </div>
            </CardHeader>
            <CardContent className="py-5">

            <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <Label className="grid h-auto gap-2 text-sm font-medium">
                LocalMaster URL
                <Input


                  className="h-11 font-medium"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="http://192.168.1.20:3000"
                />
              </Label>
              <Label className="grid h-auto gap-2 text-sm font-medium">
                Terminal
                <Input
                  className="h-11 font-medium"
                  value={terminalName}
                  onChange={(event) => setTerminalName(event.target.value)}
                  placeholder="Kasse 1"
                />
              </Label>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Button
                className="h-11 gap-2 font-semibold"
                disabled={isBusy}
                onClick={() =>
                  runAction(async () => {
                    const loadedIdentity = await loadLocalMasterIdentity(endpoint);
                    setIdentity(loadedIdentity);
                    await refreshCloudBinding();

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
                className="h-11 gap-2 bg-slate-950 font-semibold text-white hover:bg-slate-800"
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
                className="h-11 gap-2 font-semibold"
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

            <Separator className="my-5" />
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_9rem] py-4">
              <Label className="grid h-auto gap-2 text-sm font-medium">
                Code
                <Input
                  className="h-11 text-center text-lg font-semibold tracking-[0.2em]"
                  value={pairingCode}
                  onChange={(event) => setPairingCode(event.target.value)}
                  placeholder="000000"
                />
              </Label>
              <div className="grid gap-2 text-sm font-medium">
                Pairing Payload
                <div className="flex h-11 items-center overflow-hidden rounded-lg border border-dashed bg-muted/50 px-3 text-xs font-normal text-muted-foreground">
                  <span className="truncate">{pairingPayload || "Code erzeugen oder Code vom Master-PC eingeben"}</span>
                </div>
              </div>
              <Button
                className="mt-6 h-11 bg-slate-950 font-semibold text-white hover:bg-slate-800"
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
            </CardContent>
          </Card>
          </TabsContent>
          <TabsContent value="info" className="min-h-0 overflow-y-auto py-1">
            <Card className="gap-0 py-0 shadow-sm">
              <CardHeader className="border-b py-5"><CardTitle>POS-Informationen</CardTitle><CardDescription>Orientierung und aktive Konfiguration dieser Kasse.</CardDescription></CardHeader>
              <CardContent className="grid gap-3 py-5 sm:grid-cols-2">
                <StatusRow label="Tenant" value={settingsFile?.settings.tenant_id ?? "Nicht geladen"} />
                <StatusRow label="Location" value={settingsFile?.settings.location_id ?? "Nicht geladen"} />
                <StatusRow label="Sprache" value={settingsFile?.settings.language ?? "-"} />
                <StatusRow label="Betrieb" value={settingsFile?.settings.service_mode === "COUNTER_SERVICE" ? "Counterbetrieb" : settingsFile ? "Tischbetrieb" : "-"} />
                <div className="sm:col-span-2"><StatusRow label="Konfigurationsdatei" value={settingsFile?.path ?? "Nicht geladen"} /></div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cloud" className="min-h-0 overflow-y-auto py-1">
          <Card className="gap-0 py-0 shadow-sm">
            <CardHeader className="border-b py-5">
              <div className="flex items-start gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-muted"><CloudIcon className="size-5" /></span><div><CardTitle>Cloud-Anbindung</CardTitle>
            <CardDescription className="mt-1">
              Setup-Code aus Platform Admin eingeben. POS ruft lokal den LocalMaster auf; Relay-Token bleibt im LocalMaster.
            </CardDescription></div></div></CardHeader>
            <CardContent className="py-5">
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] py-4">
              <Label className="grid h-auto gap-2 text-sm font-medium">
                Relay URL
                <Input className="h-11 font-medium"
                  value={relayBaseUrl}
                  onChange={(event) => setRelayBaseUrl(event.target.value)}
                  placeholder="http://localhost:3100"
                />
              </Label>
              <Label className="grid h-auto gap-2 text-sm font-medium">
                Setup-Code
                <Input className="h-11 text-center text-lg font-semibold tracking-[0.2em]"
                  value={setupCode}
                  onChange={(event) => setSetupCode(event.target.value)}
                  placeholder="000000"
                />
              </Label>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3 py-4">
              <Button
                className="h-11 gap-2 bg-slate-950 font-semibold text-white hover:bg-slate-800"
                disabled={isBusy || setupCode.trim().length === 0}
                onClick={() =>
                  runAction(async () => {
                    const binding = await pairCloudRelay(endpoint, {
                      relay_base_url: relayBaseUrl,
                      setup_code: setupCode,
                      local_master_url: endpoint,
                    });
                    setCloudBinding(binding);
                    setStatus(binding.status === "PAIRED" ? "Standort gekoppelt und Bootstrap abgeschlossen" : "Standort gekoppelt, Bootstrap pruefen");
                  })
                }
              >
                <LinkIcon className="size-4" />
                Standort koppeln
              </Button>
              <Button
                className="h-11 gap-2 font-semibold"
                disabled={isBusy}
                onClick={() => runAction(async () => void (await refreshCloudBinding()))}
                variant="outline"
              >
                <RefreshCwIcon className="size-4" />
                Status
              </Button>
              <Button
                className="h-11 gap-2 font-semibold"
                disabled={isBusy || !cloudBinding?.relay_token_present}
                onClick={() =>
                  runAction(async () => {
                    const binding = await retryCloudBootstrap(endpoint);
                    setCloudBinding(binding);
                    setStatus("Bootstrap erneut ausgefuehrt");
                  })
                }
                variant="outline"
              >
                <RefreshCwIcon className="size-4" />
                Bootstrap
              </Button>
            </div>
            <Separator className="my-5" />
            <div className="grid gap-2 text-sm sm:grid-cols-2 py-4">
              <StatusRow label="Cloud Status" value={cloudBinding?.status ?? "Nicht geladen"} />
              <StatusRow label="Tenant" value={cloudBinding?.tenant_id ?? "-"} />
              <StatusRow label="Location" value={cloudBinding?.location_id ?? "-"} />
              <StatusRow label="Bootstrap" value={cloudBinding?.bootstrap_completed_at ?? cloudBinding?.bootstrap_error ?? "-"} />
            </div>
            </CardContent>
          </Card>
          </TabsContent>

          <TabsContent value="system" className="min-h-0 overflow-y-auto py-1">
          <Card className="gap-0 py-0 shadow-sm">
            <CardHeader className="border-b py-5"><CardTitle>Systemstatus</CardTitle><CardDescription>LocalMaster- und Terminalinformationen dieser Kasse.</CardDescription></CardHeader>
            <CardContent className="py-5">
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
              className="mt-5 h-10 gap-2 font-semibold"
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
            <Button
              className="mt-5 h-10 gap-2 font-semibold sm:ml-2"
              disabled={isBusy}
              variant="outline"
              onClick={() => runAction(async () => {
                const update = await checkForPosUpdate();
                setStatus(update.available ? "POS-Update " + update.version + " verfügbar" : "POS ist aktuell");
              })}
            >
              <RefreshCwIcon className="size-4" />
              Nach POS-Update suchen
            </Button>
            </CardContent>
          </Card>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/30 px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
