import { useEffect, useMemo, useState } from "react";
import { Copy, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@easytable/ui/components/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@easytable/ui/components/table";

import type { CatalogTax, CatalogTaxInput } from "../../../lib/local-master";
import { CatalogFilters } from "./components/CatalogFilters";

type TaxViewProps = {
  taxes: CatalogTax[];
  isLoading: boolean;
  onReload: () => void;
  onCreate: (input: CatalogTaxInput) => Promise<void>;
  onUpdate: (taxId: string, input: CatalogTaxInput) => Promise<void>;
  onDelete: (taxId: string) => Promise<void>;
  onDuplicate: (taxId: string) => Promise<void>;
};

export function TaxView({
  taxes,
  isLoading,
  onReload,
  onCreate,
  onUpdate,
  onDelete,
  onDuplicate,
}: TaxViewProps) {
  const [search, setSearch] = useState("");

  const filteredTaxes = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return taxes;
    }

    return taxes.filter((tax) =>
      [tax.id, tax.name, formatTaxRate(tax.rate_bps), String(tax.rate_bps)].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [search, taxes]);

  async function handleDelete(tax: CatalogTax) {
    const message = tax.product_count > 0
      ? `Steuer "${tax.name}" ist noch ${tax.product_count} Produkten zugeordnet. Loeschen versuchen?`
      : `Steuer "${tax.name}" loeschen?`;

    if (!window.confirm(message)) {
      return;
    }

    await onDelete(tax.id);
  }

  return (
    <section className="rounded-md border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Steuern</h2>
          <p className="text-sm text-muted-foreground">Steuersaetze erstellen, bearbeiten, kopieren und Produkten zuweisen.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={isLoading} onClick={onReload} type="button" variant="outline">
            <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} />
            Laden
          </Button>
          <TaxFormDialog mode="create" onSubmit={onCreate} />
        </div>
      </div>

      <CatalogFilters
        onSearchChange={setSearch}
        search={search}
        searchPlaceholder="Steuername, ID oder Satz suchen"
      />

      <div className="p-2 sm:p-3">
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>ID</TableHead>
                <TableHead className="text-right">Satz</TableHead>
                <TableHead className="text-right">Produkte</TableHead>
                <TableHead className="text-right">Sortierung</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTaxes.map((tax) => (
                <TableRow key={tax.id}>
                  <TableCell className="font-medium">{tax.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{tax.id}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTaxRate(tax.rate_bps)}</TableCell>
                  <TableCell className="text-right tabular-nums">{tax.product_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{tax.sort_order}</TableCell>
                  <TableCell>
                    <Badge variant={tax.product_count > 0 ? "secondary" : "outline"}>
                      {tax.product_count > 0 ? "In Nutzung" : "Leer"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <TaxFormDialog mode="edit" onSubmit={(input) => onUpdate(tax.id, input)} tax={tax} />
                      <DuplicateTaxButton onClick={() => void onDuplicate(tax.id)} />
                      <Button onClick={() => void handleDelete(tax)} size="icon-sm" title="Loeschen" type="button" variant="ghost">
                        <Trash2 className="size-4" />
                        <span className="sr-only">Loeschen</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {!isLoading && filteredTaxes.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={7}>
                    Keine Steuern gefunden.
                  </TableCell>
                </TableRow>
              ) : null}

              {isLoading ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={7}>
                    Steuern werden geladen.
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

type TaxFormDialogProps = {
  tax?: CatalogTax;
  mode: "create" | "edit";
  onSubmit: (input: CatalogTaxInput) => Promise<void>;
};

type TaxFormState = {
  id: string;
  name: string;
  rate: string;
  sort_order: string;
};

function TaxFormDialog({ tax, mode, onSubmit }: TaxFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TaxFormState>(() => createInitialState(tax));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (open) {
      setForm(createInitialState(tax));
      setError(null);
    }
  }, [open, tax]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      await onSubmit({
        id: isEdit ? undefined : form.id.trim() || undefined,
        name: form.name.trim(),
        rate_bps: parseRateToBps(form.rate),
        sort_order: Number(form.sort_order),
      });
      setOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Steuer konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button onClick={() => setOpen(true)} size={isEdit ? "icon-sm" : "default"} title={isEdit ? "Bearbeiten" : "Steuer erstellen"} type="button" variant={isEdit ? "ghost" : "default"}>
        {isEdit ? <Pencil className="size-4" /> : <Plus className="size-4" />}
        {!isEdit ? "Steuer" : <span className="sr-only">Bearbeiten</span>}
      </Button>
      <DialogContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Steuer bearbeiten" : "Steuer erstellen"}</DialogTitle>
            <DialogDescription>Produkte verwenden diese Steuer per Auswahl, nicht mehr ueber manuelle Steuerfelder.</DialogDescription>
          </DialogHeader>

          {!isEdit ? (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">ID</span>
              <Input onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder="tax_standard_ch" value={form.id} />
            </label>
          ) : null}
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Satz (%)</span>
            <Input min="0" onChange={(event) => setForm({ ...form, rate: event.target.value })} required step="0.01" type="number" value={form.rate} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Sortierung</span>
            <Input min="0" onChange={(event) => setForm({ ...form, sort_order: event.target.value })} required type="number" value={form.sort_order} />
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

function DuplicateTaxButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} size="icon-sm" title="Kopieren" type="button" variant="ghost">
      <Copy className="size-4" />
      <span className="sr-only">Kopieren</span>
    </Button>
  );
}

function createInitialState(tax?: CatalogTax): TaxFormState {
  return {
    id: tax?.id ?? "",
    name: tax?.name ?? "",
    rate: formatRateForInput(tax?.rate_bps ?? 810),
    sort_order: String(tax?.sort_order ?? 10),
  };
}

function parseRateToBps(value: string) {
  const parsed = Number(value.replace(",", ".").trim());

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Steuersatz muss eine positive Zahl sein.");
  }

  return Math.round(parsed * 100);
}

function formatRateForInput(rateBps: number) {
  return String(rateBps / 100);
}

function formatTaxRate(rateBps: number) {
  return `${(rateBps / 100).toLocaleString("de-CH", { maximumFractionDigits: 2 })}%`;
}