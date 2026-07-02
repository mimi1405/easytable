import { useEffect, useState, type FormEvent } from "react";
import { MapPin, Pencil } from "lucide-react";

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

import type { Location, LocationInput } from "../../../lib/relay-sync-api";
import { createLocationFormState, normalizeOptionalText } from "../utils";

type LocationFormDialogProps = {
  location?: Location;
  mode: "create" | "edit";
  disabled?: boolean;
  onSubmit: (input: LocationInput) => Promise<void>;
};

export function LocationFormDialog({ location, mode, disabled = false, onSubmit }: LocationFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => createLocationFormState(location));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (open) {
      setForm(createLocationFormState(location));
      setError(null);
    }
  }, [location, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      await onSubmit({
        name: form.name.trim(),
        slug: form.slug.trim(),
        address: normalizeOptionalText(form.address),
        local_master_instance_id: normalizeOptionalText(form.local_master_instance_id),
        status: form.status,
      });
      setOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Location konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button disabled={disabled} onClick={() => setOpen(true)} size={isEdit ? "icon-sm" : "default"} title={isEdit ? "Bearbeiten" : "Location erstellen"} type="button" variant={isEdit ? "ghost" : "default"}>
        {isEdit ? <Pencil className="size-4" /> : <MapPin className="size-4" />}
        {!isEdit ? "Location" : <span className="sr-only">Bearbeiten</span>}
      </Button>
      <DialogContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Location bearbeiten" : "Location erstellen"}</DialogTitle>
            <DialogDescription>Eine Location ist der Standort, an den sich spaeter genau ein aktiver LocalMaster koppelt.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Slug</span>
              <Input onChange={(event) => setForm({ ...form, slug: event.target.value })} pattern="[a-z0-9-]+" required value={form.slug} />
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Adresse</span>
            <Input onChange={(event) => setForm({ ...form, address: event.target.value })} value={form.address} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">LocalMaster Instance ID</span>
            <Input onChange={(event) => setForm({ ...form, local_master_instance_id: event.target.value })} value={form.local_master_instance_id} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Status</span>
            <select
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              onChange={(event) => setForm({ ...form, status: event.target.value as LocationInput["status"] })}
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
