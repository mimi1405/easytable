import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus } from "lucide-react";

import { Button } from "@easytable/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@easytable/ui/components/dialog";
import { Input } from "@easytable/ui/components/input";

import type { Tenant, TenantInput } from "../../../lib/relay-sync-api";
import { createTenantFormState, normalizeOptionalText } from "../utils";

type TenantFormDialogProps = {
  tenant?: Tenant;
  mode: "create" | "edit";
  onSubmit: (input: TenantInput) => Promise<void>;
};

export function TenantFormDialog({ tenant, mode, onSubmit }: TenantFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => createTenantFormState(tenant));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (open) {
      setForm(createTenantFormState(tenant));
      setError(null);
    }
  }, [open, tenant]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      await onSubmit({
        name: form.name.trim(),
        slug: form.slug.trim(),
        email: normalizeOptionalText(form.email),
        phone: normalizeOptionalText(form.phone),
        website: normalizeOptionalText(form.website),
        status: form.status,
      });
      setOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Tenant konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button onClick={() => setOpen(true)} size={isEdit ? "icon-sm" : "default"} title={isEdit ? "Bearbeiten" : "Tenant erstellen"} type="button" variant={isEdit ? "ghost" : "default"}>
        {isEdit ? <Pencil className="size-4" /> : <Plus className="size-4" />}
        {!isEdit ? "Tenant" : <span className="sr-only">Bearbeiten</span>}
      </Button>
      <DialogContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Tenant bearbeiten" : "Tenant erstellen"}</DialogTitle>
            <DialogDescription>Tenants sind die Cloud-Klammer fuer Standorte, Benutzer und Sync-Daten.</DialogDescription>
          </DialogHeader>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Slug</span>
            <Input onChange={(event) => setForm({ ...form, slug: event.target.value })} pattern="[a-z0-9-]+" required value={form.slug} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">E-Mail</span>
              <Input onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" value={form.email} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Telefon</span>
              <Input onChange={(event) => setForm({ ...form, phone: event.target.value })} value={form.phone} />
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Website</span>
            <Input onChange={(event) => setForm({ ...form, website: event.target.value })} type="url" value={form.website} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Status</span>
            <select
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              onChange={(event) => setForm({ ...form, status: event.target.value as TenantInput["status"] })}
              value={form.status}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
          </label>

          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button disabled={isSaving} type="submit">
              {isSaving ? "Speichert..." : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
