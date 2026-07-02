import { useEffect, useState, type FormEvent } from "react";
import { Pencil, RadioTower } from "lucide-react";

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
import { Switch } from "@easytable/ui/components/switch";

import type { OutputStation, OutputStationInput } from "../../../lib/relay-sync-api";
import { createOutputStationFormState } from "../utils";

type OutputStationFormDialogProps = {
  station?: OutputStation;
  mode: "create" | "edit";
  disabled?: boolean;
  onSubmit: (input: OutputStationInput) => Promise<void>;
};

export function OutputStationFormDialog({ station, mode, disabled = false, onSubmit }: OutputStationFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => createOutputStationFormState(station));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (open) {
      setForm(createOutputStationFormState(station));
      setError(null);
    }
  }, [open, station]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      await onSubmit({
        name: form.name.trim(),
        kind: form.kind,
        is_active: form.is_active,
        sort_order: Number(form.sort_order),
      });
      setOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Station konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button disabled={disabled} onClick={() => setOpen(true)} size={isEdit ? "icon-sm" : "default"} title={isEdit ? "Bearbeiten" : "Station erstellen"} type="button" variant={isEdit ? "ghost" : "default"}>
        {isEdit ? <Pencil className="size-4" /> : <RadioTower className="size-4" />}
        {!isEdit ? "Station" : <span className="sr-only">Bearbeiten</span>}
      </Button>
      <DialogContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Station bearbeiten" : "Station erstellen"}</DialogTitle>
            <DialogDescription>Stationen definieren KDS- und Bondrucker-Ausgabe fuer eine Location.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Typ</span>
              <select
                className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                onChange={(event) => setForm({ ...form, kind: event.target.value as OutputStationInput["kind"] })}
                value={form.kind}
              >
                <option value="KDS_AND_PRINTER">KDS + Bon</option>
                <option value="KDS">Nur KDS</option>
                <option value="PRINTER">Nur Bon</option>
                <option value="NONE">Keine Ausgabe</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Sortierung</span>
            <Input min="0" onChange={(event) => setForm({ ...form, sort_order: event.target.value })} required type="number" value={form.sort_order} />
          </label>
          <label className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm font-medium">Aktiv</span>
            <Switch checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} />
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
