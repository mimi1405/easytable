import { useMemo, useState } from "react";
import { SlidersHorizontal, Trash2 } from "lucide-react";

import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import { Input } from "@easytable/ui/components/input";
import { Label } from "@easytable/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@easytable/ui/components/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@easytable/ui/components/sheet";

import type { CatalogCategory, CatalogProduct, ProductVariantGroup, ProductVariantGroupInput } from "../../../../lib/local-master";
import { formatMoney } from "../utils";

type Props = {
  mode: "PRODUCT" | "CATEGORY";
  product?: CatalogProduct;
  category?: CatalogCategory;
  products?: CatalogProduct[];
  groups: ProductVariantGroup[];
  onCreate: (input: ProductVariantGroupInput) => Promise<void>;
  onUpdate: (groupId: string, input: ProductVariantGroupInput) => Promise<void>;
  onDelete: (groupId: string) => Promise<void>;
};

type ItemDraft = { id?: string; name: string; price_delta: number; is_default: boolean; sort_order: number };

export function VariantGroupsSheet({ mode, product, category, products = [], groups, onCreate, onUpdate, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const targetName = mode === "PRODUCT" ? product?.name : category?.name;
  const directGroups = groups.filter((group) => mode === "PRODUCT" ? group.applies_to === "PRODUCT" && group.product_id === product?.id : group.applies_to === "CATEGORY" && group.category === category?.name);
  const inheritedGroups = mode === "PRODUCT" ? groups.filter((group) => group.applies_to === "CATEGORY" && group.category === product?.category) : [];
  const editingGroup = directGroups.find((group) => group.id === editingId) ?? null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="icon-sm" title="Varianten verwalten" type="button" variant="ghost">
          <SlidersHorizontal className="size-4" />
          <span className="sr-only">Varianten</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" side="right">
        <SheetHeader>
          <SheetTitle>Varianten für {targetName}</SheetTitle>
          <SheetDescription>{mode === "CATEGORY" ? "Varianten werden an alle Produkte dieser Kategorie übergeben." : "Produkt-Gruppen gelten nur für dieses Produkt; Kategorie-Gruppen werden geerbt von der zugehörigen Kategorie."}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {inheritedGroups.length > 0 ? <GroupList title="Geerbte Gruppen" groups={inheritedGroups} readonly /> : null}
          <GroupList title="Direkte Gruppen" groups={directGroups} onEdit={setEditingId} onDelete={(group) => void onDelete(group.id)} />
          <VariantGroupForm
            key={editingGroup?.id ?? "new"}
            category={category}
            group={editingGroup}
            mode={mode}
            product={product}
            products={products}
            onCancel={() => setEditingId(null)}
            onSubmit={async (input) => {
              if (editingGroup) await onUpdate(editingGroup.id, input);
              else await onCreate(input);
              setEditingId(null);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function GroupList({ title, groups, readonly = false, onEdit, onDelete }: { title: string; groups: ProductVariantGroup[]; readonly?: boolean; onEdit?: (id: string) => void; onDelete?: (group: ProductVariantGroup) => void }) {
  return <div className="rounded-md border p-3"><h3 className="mb-2 font-semibold">{title}</h3>{groups.length === 0 ? <p className="text-sm text-muted-foreground">Keine Variantengruppen.</p> : groups.map((group) => <div className="mb-2 rounded-md bg-muted/40 p-3" key={group.id}><div className="flex items-start justify-between gap-2"><div><div className="font-medium">{group.name}</div><div className="mt-1 flex flex-wrap gap-1">{group.items.map((item) => <Badge key={item.id} variant="secondary">{item.name} {item.price_delta ? `+${formatMoney(item.price_delta)}` : ""}</Badge>)}</div></div>{!readonly ? <div className="flex gap-1"><Button onClick={() => onEdit?.(group.id)} size="sm" type="button" variant="outline">Bearbeiten</Button><Button onClick={() => onDelete?.(group)} size="icon-sm" type="button" variant="ghost"><Trash2 className="size-4" /></Button></div> : null}</div></div>)}</div>;
}

function VariantGroupForm({ mode, product, category, products, group, onSubmit, onCancel }: { mode: "PRODUCT" | "CATEGORY"; product?: CatalogProduct; category?: CatalogCategory; products: CatalogProduct[]; group: ProductVariantGroup | null; onSubmit: (input: ProductVariantGroupInput) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(group?.name ?? "");
  const [productId, setProductId] = useState(group?.product_id ?? product?.id ?? products[0]?.id ?? "");
  const [items, setItems] = useState<ItemDraft[]>(group?.items.map((item) => ({ id: item.id, name: item.name, price_delta: item.price_delta, is_default: item.is_default, sort_order: item.sort_order })) ?? [
  ]);
  const basicProducts = useMemo(() => products.filter((entry) => entry.product_type === "BASIC"), [products]);

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  return <form className="rounded-md border p-3" onSubmit={(event) => { event.preventDefault(); void onSubmit({ applies_to: mode, product_id: mode === "PRODUCT" ? productId : null, category: mode === "CATEGORY" ? category?.name ?? null : null, name, selection_type: "SINGLE", min_select: 1, max_select: 1, sort_order: group?.sort_order ?? 10, is_required: true, items }); }}>
    <h3 className="mb-3 font-semibold">{group ? "Variantengruppe bearbeiten" : "Variantengruppe erstellen"}</h3>
    <div className="grid gap-3"><Label>Name<Input value={name} onChange={(event) => setName(event.target.value)} /></Label>{mode === "PRODUCT" && !product ? <Label>Produkt<Select value={productId} onValueChange={setProductId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{basicProducts.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent></Select></Label> : null}</div>
    <div className="mt-4 flex flex-col gap-2">{items.map((item, index) => <div className="grid grid-cols-[1fr_7rem_2rem] gap-2" key={item.id ?? index}><Input value={item.name} onChange={(event) => updateItem(index, { name: event.target.value })} /><Input type="number" step="0.05" value={(item.price_delta / 100).toFixed(2)} onChange={(event) => updateItem(index, { price_delta: Math.round(Number(event.target.value) * 100) })} /><Button onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} size="icon-sm" type="button" variant="ghost"><Trash2 className="size-4" /></Button></div>)}</div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button 
        onClick={() => setItems((current) => [...current, { name: "", price_delta: 0, is_default: false, sort_order: (current.length + 1) * 10 }])} type="button" variant="outline">Item hinzufügen
        </Button>
        <Button 
        type="submit">Speichern</Button>
        {group ? <Button onClick={onCancel} type="button" variant="ghost">Abbrechen
        </Button> : null}
      </div>
  </form>;
}
