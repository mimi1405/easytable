import { useEffect, useState } from "react";
import { Copy, Pencil, Plus } from "lucide-react";

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

import type {
  CatalogCategory,
  CatalogProduct,
  CatalogProductInput,
  CatalogProductType,
  CatalogTax,
} from "../../../../lib/local-master";
import { formatCentsForInput, parseMoneyToCents } from "../utils";

type ProductFormDialogProps = {
  categories: CatalogCategory[];
  taxes: CatalogTax[];
  product?: CatalogProduct;
  mode: "create" | "edit";
  onSubmit: (input: CatalogProductInput) => Promise<void>;
};

type ProductFormState = {
  category_id: string;
  tax_id: string;
  product_type: CatalogProductType;
  name: string;
  price: string;
  station: string;
  is_available: boolean;
};

export function ProductFormDialog({ categories, taxes, product, mode, onSubmit }: ProductFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProductFormState>(() => createInitialState(categories, taxes, product));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (open) {
      setForm(createInitialState(categories, taxes, product));
      setError(null);
    }
  }, [categories, open, product, taxes]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      await onSubmit({
        category_id: form.category_id,
        tax_id: form.tax_id,
        product_type: form.product_type,
        name: form.name.trim(),
        price: parseMoneyToCents(form.price),
        station: form.station.trim(),
        is_available: form.is_available,
      });
      setOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Produkt konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button onClick={() => setOpen(true)} size={isEdit ? "icon-sm" : "default"} title={isEdit ? "Bearbeiten" : "Produkt erstellen"} type="button" variant={isEdit ? "ghost" : "default"}>
        {isEdit ? <Pencil className="size-4" /> : <Plus className="size-4" />}
        {!isEdit ? "Produkt" : <span className="sr-only">Bearbeiten</span>}
      </Button>
      <DialogContent className="sm:max-w-2xl">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Produkt bearbeiten" : "Produkt erstellen"}</DialogTitle>
            <DialogDescription>Katalogdaten werden lokal im LocalMaster gespeichert.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Kategorie</span>
              <select
                className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                disabled={categories.length === 0}
                onChange={(event) => setForm({ ...form, category_id: event.target.value })}
                required
                value={form.category_id}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Typ</span>
              <select
                className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                onChange={(event) => setForm({ ...form, product_type: event.target.value as CatalogProductType })}
                value={form.product_type}
              >
                <option value="BASIC">BASIC</option>
                <option value="SERVICE">SERVICE</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Preis (CHF)</span>
              <Input min="0" onChange={(event) => setForm({ ...form, price: event.target.value })} required step="0.01" type="number" value={form.price} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Steuer</span>
              <select
                className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                disabled={taxes.length === 0}
                onChange={(event) => setForm({ ...form, tax_id: event.target.value })}
                required
                value={form.tax_id}
              >
                {taxes.map((tax) => (
                  <option key={tax.id} value={tax.id}>
                    {tax.name} ({formatTaxRate(tax.rate_bps)})
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Station</span>
              <Input onChange={(event) => setForm({ ...form, station: event.target.value })} required value={form.station} />
            </label>
          </div>

          <label className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm font-medium">Verfuegbar</span>
            <Switch checked={form.is_available} onCheckedChange={(checked) => setForm({ ...form, is_available: checked })} />
          </label>

          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button disabled={isSaving || categories.length === 0 || taxes.length === 0} type="submit">
              {isSaving ? "Speichert..." : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DuplicateIconButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} size="icon-sm" title="Kopieren" type="button" variant="ghost">
      <Copy className="size-4" />
      <span className="sr-only">Kopieren</span>
    </Button>
  );
}

function createInitialState(categories: CatalogCategory[], taxes: CatalogTax[], product?: CatalogProduct): ProductFormState {
  return {
    category_id: product?.category_id ?? categories[0]?.id ?? "",
    tax_id: product?.tax_id ?? taxes[0]?.id ?? "",
    product_type: product?.product_type ?? "BASIC",
    name: product?.name ?? "",
    price: formatCentsForInput(product?.price ?? 0),
    station: product?.station ?? "BAR",
    is_available: product?.is_available ?? true,
  };
}

function formatTaxRate(rateBps: number) {
  return `${(rateBps / 100).toLocaleString("de-CH", { maximumFractionDigits: 2 })}%`;
}