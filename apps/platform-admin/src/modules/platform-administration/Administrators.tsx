import { type FormEvent, useEffect, useState } from "react";
import { Archive, KeyRound, Pencil, Plus, RefreshCcw, ShieldCheck, Trash2 } from "lucide-react";

import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@easytable/ui/components/dialog";
import { Input } from "@easytable/ui/components/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@easytable/ui/components/table";

import { ErrorBanner } from "../../components/ErrorBanner";
import {
  archivePlatformAdministrator,
  createPlatformAdministrator,
  deletePlatformAdministrator,
  getRelaySyncApiUrl,
  loadPlatformAdministrators,
  resetPlatformAdministratorPassword,
  updatePlatformAdministrator,
  type PlatformAdministrator,
  type PlatformAdministratorInput,
} from "../../lib/relay-sync-api";

export function Administrators() {
  const [administrators, setAdministrators] = useState<PlatformAdministrator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function refreshAdministrators() {
    setIsLoading(true);
    setError(null);

    try {
      setAdministrators(await loadPlatformAdministrators());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Administratoren konnten nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  }

  async function runAction(action: () => Promise<string | void>) {
    setError(null);
    setActionMessage(null);

    try {
      const message = await action();
      await refreshAdministrators();
      setActionMessage(message ?? "Aktion erfolgreich ausgefuehrt.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Aktion fehlgeschlagen.");
      throw actionError;
    }
  }

  async function runPasswordReset(user: PlatformAdministrator) {
    setBusyUserId(user.user_id);

    try {
      await runAction(async () => {
        const result = await resetPlatformAdministratorPassword(user.user_id);
        return result.email_sent
          ? "Setup-Link wurde an " + user.email + " gesendet."
          : "Setup-Link wurde erzeugt.";
      });
    } finally {
      setBusyUserId(null);
    }
  }

  async function runLifecycleAction(user: PlatformAdministrator, kind: "archive" | "delete") {
    if (kind === "delete" && !window.confirm("Platform-Admin " + user.email + " wirklich loeschen?")) {
      return;
    }

    setBusyUserId(user.user_id + ":" + kind);

    try {
      await runAction(async () => {
        if (kind === "archive") {
          await archivePlatformAdministrator(user.user_id);
          return user.email + " wurde archiviert.";
        }

        await deletePlatformAdministrator(user.user_id);
        return user.email + " wurde geloescht.";
      });
    } finally {
      setBusyUserId(null);
    }
  }

  useEffect(() => {
    void refreshAdministrators();
  }, []);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-md border bg-card p-4 text-card-foreground shadow-sm sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Platform / Administration</p>
          <h2 className="text-2xl font-semibold tracking-normal">Administratoren</h2>
        </div>
        <span className="max-w-full truncate rounded-md border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
          {getRelaySyncApiUrl()}
        </span>
      </section>

      {error ? <ErrorBanner message={error} onRetry={refreshAdministrators} /> : null}
      {actionMessage ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm font-medium text-emerald-700">
          {actionMessage}
        </div>
      ) : null}

      <section className="rounded-md border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Platform Admins</h3>
            <p className="text-sm text-muted-foreground">Cloud-Accounts mit Zugriff auf diese Platform-Admin-App.</p>
          </div>
          <div className="flex gap-2">
            <Button className="gap-2" onClick={refreshAdministrators} type="button" variant="outline">
              <RefreshCcw className={isLoading ? "size-4 animate-spin" : "size-4"} />
              Laden
            </Button>
            <AdministratorFormDialog
              mode="create"
              onSubmit={(input) =>
                runAction(async () => {
                  const result = await createPlatformAdministrator(input);
                  return result.email_sent
                    ? "Admin erstellt und Setup-Link an " + input.email + " gesendet."
                    : "Admin erstellt.";
                })
              }
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>E-Mail</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aktualisiert</TableHead>
              <TableHead className="w-48 text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {administrators.map((administrator) => (
              <TableRow key={administrator.user_id}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{administrator.display_name}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm">{administrator.email}</TableCell>
                <TableCell>
                  <Badge variant={administrator.status === "ACTIVE" ? "secondary" : "outline"}>{administrator.status}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatDate(administrator.updated_at)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <AdministratorFormDialog
                      administrator={administrator}
                      mode="edit"
                      onSubmit={(input) =>
                        runAction(async () => void (await updatePlatformAdministrator(administrator.user_id, input)))
                      }
                    />
                    <Button
                      className="gap-2"
                      disabled={busyUserId !== null}
                      onClick={() => runPasswordReset(administrator)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <KeyRound className={busyUserId === administrator.user_id ? "size-4 animate-spin" : "size-4"} />
                      Reset
                    </Button>
                    <Button
                      disabled={busyUserId !== null || administrator.status === "DISABLED"}
                      onClick={() => runLifecycleAction(administrator, "archive")}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Archive className={busyUserId === administrator.user_id + ":archive" ? "size-4 animate-spin" : "size-4"} />
                      <span className="sr-only">Archivieren</span>
                    </Button>
                    <Button
                      disabled={busyUserId !== null}
                      onClick={() => runLifecycleAction(administrator, "delete")}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className={busyUserId === administrator.user_id + ":delete" ? "size-4 animate-spin" : "size-4"} />
                      <span className="sr-only">Loeschen</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}

            {!isLoading && administrators.length === 0 ? (
              <TableRow>
                <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                  Keine Platform-Administratoren vorhanden.
                </TableCell>
              </TableRow>
            ) : null}

            {isLoading ? (
              <TableRow>
                <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                  Administratoren werden geladen...
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

type AdministratorFormDialogProps = {
  administrator?: PlatformAdministrator;
  mode: "create" | "edit";
  onSubmit: (input: PlatformAdministratorInput) => Promise<void>;
};

function AdministratorFormDialog({ administrator, mode, onSubmit }: AdministratorFormDialogProps) {
  const isEdit = mode === "edit";
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<PlatformAdministratorInput>(() => createFormState(administrator));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);

    try {
      await onSubmit(form);
      setOpen(false);
      setForm(createFormState(administrator));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button className="gap-2" size="sm" type="button" variant={isEdit ? "outline" : "default"}>
          {isEdit ? <Pencil className="size-4" /> : <Plus className="size-4" />}
          {isEdit ? "Bearbeiten" : "Admin erstellen"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Administrator bearbeiten" : "Administrator erstellen"}</DialogTitle>
            <DialogDescription>
              Platform-Admins sind Cloud-Accounts fuer die Platform-Administration.
            </DialogDescription>
          </DialogHeader>

          <label className="grid gap-2 text-sm font-medium">
            Name
            <Input onChange={(event) => setForm({ ...form, display_name: event.target.value })} required value={form.display_name} />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            E-Mail
            <Input
              disabled={isEdit}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
              type="email"
              value={form.email}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium">
            Status
            <select
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
              onChange={(event) => setForm({ ...form, status: event.target.value as PlatformAdministratorInput["status"] })}
              value={form.status}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INVITED">INVITED</option>
              <option value="DISABLED">DISABLED</option>
            </select>
          </label>

          <DialogFooter>
            <Button disabled={isSaving} type="submit">
              {isSaving ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function createFormState(administrator?: PlatformAdministrator): PlatformAdministratorInput {
  return {
    email: administrator?.email ?? "",
    display_name: administrator?.display_name ?? "",
    status: administrator?.status ?? "ACTIVE",
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
