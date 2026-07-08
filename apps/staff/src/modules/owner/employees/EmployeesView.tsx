import { useEffect, useState, type FormEvent } from "react";
import { Archive, Hash, KeyRound, Pencil, RefreshCw, Trash2, UserPlus } from "lucide-react";

import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@easytable/ui/components/dialog";
import { Input } from "@easytable/ui/components/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@easytable/ui/components/table";

import type { TenantLocationUser, TenantLocationUserInput, TenantUserRole } from "../../../lib/local-master";

type EmployeesViewProps = {
  users: TenantLocationUser[];
  isLoading: boolean;
  onArchive: (userId: string) => Promise<void>;
  onCreate: (input: TenantLocationUserInput) => Promise<void>;
  onDelete: (userId: string) => Promise<void>;
  onReload: () => void;
  onResetPassword: (userId: string) => Promise<void>;
  onResetPin: (userId: string) => Promise<string | null | undefined>;
  onUpdate: (userId: string, input: Partial<TenantLocationUserInput>) => Promise<void>;
};

const roles: TenantUserRole[] = ["OWNER", "MANAGER", "STAFF", "KDS", "POS_OPERATOR"];

export function EmployeesView({
  users,
  isLoading,
  onArchive,
  onCreate,
  onDelete,
  onReload,
  onResetPassword,
  onResetPin,
  onUpdate,
}: EmployeesViewProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  async function runReset(user: TenantLocationUser, kind: "password" | "pin") {
    setBusyUserId(user.user_id + ":" + kind);
    setMessage(null);

    try {
      if (kind === "password") {
        await onResetPassword(user.user_id);
        setMessage("Setup-Link fuer " + user.display_name + " wurde per E-Mail verschickt.");
      } else {
        const generatedPin = await onResetPin(user.user_id);
        setMessage(
          generatedPin
            ? "Neue PIN fuer " + user.display_name + ": " + generatedPin
            : "PIN fuer " + user.display_name + " wurde aktualisiert."
        );
      }
    } catch (resetError) {
      setMessage(resetError instanceof Error ? resetError.message : "Reset fehlgeschlagen.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function runLifecycleAction(user: TenantLocationUser, kind: "archive" | "delete") {
    if (kind === "delete" && !window.confirm("Mitarbeiter " + user.display_name + " wirklich aus dieser Location loeschen?")) {
      return;
    }

    setBusyUserId(user.user_id + ":" + kind);
    setMessage(null);

    try {
      if (kind === "archive") {
        await onArchive(user.user_id);
        setMessage(user.display_name + " wurde archiviert.");
      } else {
        await onDelete(user.user_id);
        setMessage(user.display_name + " wurde geloescht.");
      }
    } catch (actionError) {
      setMessage(actionError instanceof Error ? actionError.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <section className="rounded-md border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Mitarbeiter</h2>
          <p className="text-sm text-muted-foreground">Benutzer, Rollen, Setup-Link und POS-PIN.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={isLoading} onClick={onReload} type="button" variant="outline">
            <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} />
            Laden
          </Button>
          <EmployeeDialog mode="create" onSubmit={onCreate} />
        </div>
      </div>

      <div className="p-2 sm:p-3">
        {message ? <p className="mb-3 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Rolle</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.user_id}>
                  <TableCell>
                    <div className="grid gap-1">
                      <span className="font-medium">{user.display_name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{user.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{user.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={user.has_password ? "secondary" : "outline"}>{user.has_password ? "Passwort" : "Kein Passwort"}</Badge>
                      <Badge variant={user.has_pin ? "secondary" : "outline"}>{user.has_pin ? "PIN" : "Kein PIN"}</Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.status === "ACTIVE" && user.is_active ? "secondary" : "outline"}>
                      {user.is_active ? user.status : "INACTIVE"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button disabled={busyUserId !== null} onClick={() => runReset(user, "password")} size="icon-sm" type="button" variant="ghost">
                        <KeyRound className={busyUserId === user.user_id + ":password" ? "size-4 animate-spin" : "size-4"} />
                        <span className="sr-only">Passwort zuruecksetzen</span>
                      </Button>
                      <Button disabled={busyUserId !== null} onClick={() => runReset(user, "pin")} size="icon-sm" type="button" variant="ghost">
                        <Hash className={busyUserId === user.user_id + ":pin" ? "size-4 animate-spin" : "size-4"} />
                        <span className="sr-only">PIN zuruecksetzen</span>
                      </Button>
                      <EmployeeDialog mode="edit" onSubmit={(input) => onUpdate(user.user_id, input)} user={user} />
                      <Button
                        disabled={busyUserId !== null || (!user.is_active && user.status === "DISABLED")}
                        onClick={() => runLifecycleAction(user, "archive")}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Archive className={busyUserId === user.user_id + ":archive" ? "size-4 animate-spin" : "size-4"} />
                        <span className="sr-only">Archivieren</span>
                      </Button>
                      <Button disabled={busyUserId !== null} onClick={() => runLifecycleAction(user, "delete")} size="icon-sm" type="button" variant="ghost">
                        <Trash2 className={busyUserId === user.user_id + ":delete" ? "size-4 animate-spin" : "size-4"} />
                        <span className="sr-only">Loeschen</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {!isLoading && users.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                    Keine Mitarbeiter vorhanden.
                  </TableCell>
                </TableRow>
              ) : null}

              {isLoading ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                    Mitarbeiter werden geladen.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}

function EmployeeDialog({
  disabled = false,
  mode,
  onSubmit,
  user,
}: {
  disabled?: boolean;
  mode: "create" | "edit";
  onSubmit: (input: TenantLocationUserInput) => Promise<void>;
  user?: TenantLocationUser;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => createEmployeeForm(user));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (open) {
      setForm(createEmployeeForm(user));
      setError(null);
    }
  }, [open, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await onSubmit({
        email: form.email.trim(),
        display_name: form.display_name.trim(),
        role: form.role,
        password: form.password.trim() || undefined,
        pin: form.pin.trim() || undefined,
        status: form.status,
        is_active: form.is_active,
      });
      setOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Mitarbeiter konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button disabled={disabled} onClick={() => setOpen(true)} size={isEdit ? "icon-sm" : "default"} type="button" variant={isEdit ? "ghost" : "default"}>
        {isEdit ? <Pencil className="size-4" /> : <UserPlus className="size-4" />}
        {!isEdit ? "Mitarbeiter" : <span className="sr-only">Bearbeiten</span>}
      </Button>
      <DialogContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Mitarbeiter bearbeiten" : "Mitarbeiter anlegen"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input onChange={(event) => setForm({ ...form, display_name: event.target.value })} required value={form.display_name} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">E-Mail</span>
              <Input onChange={(event) => setForm({ ...form, email: event.target.value })} required type="email" value={form.email} />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Rolle</span>
              <select className="h-9 rounded-md border border-input bg-background px-2.5 text-sm" onChange={(event) => setForm({ ...form, role: event.target.value as TenantUserRole })} value={form.role}>
                {roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Status</span>
              <select className="h-9 rounded-md border border-input bg-background px-2.5 text-sm" onChange={(event) => setForm({ ...form, status: event.target.value as TenantLocationUserInput["status"] })} value={form.status}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INVITED">INVITED</option>
                <option value="DISABLED">DISABLED</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{isEdit ? "Neues Passwort" : "Passwort direkt setzen (optional)"}</span>
              <Input minLength={8} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" value={form.password} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">POS PIN</span>
              <Input inputMode="numeric" onChange={(event) => setForm({ ...form, pin: event.target.value })} pattern="[0-9]{4,8}" value={form.pin} />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} type="checkbox" />
            Fuer diese Location aktiv
          </label>

          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button disabled={isSaving} type="submit">{isSaving ? "Speichert..." : "Speichern"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function createEmployeeForm(user?: TenantLocationUser) {
  return {
    email: user?.email ?? "",
    display_name: user?.display_name ?? "",
    role: user?.role ?? "STAFF",
    password: "",
    pin: "",
    status: user?.status ?? "ACTIVE",
    is_active: user?.is_active ?? true,
  };
}
