import { useMemo, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@easytable/ui/components/badge";
import { Button } from "@easytable/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@easytable/ui/components/table";

import type { CatalogCategory, CatalogProduct, CatalogProductInput, CatalogTax } from "../../../lib/local-master";
import { CatalogFilters } from "./components/CatalogFilters";
import { DuplicateIconButton, ProductFormDialog } from "./components/ProductFormDialog";
import { formatMoney, uniqueSorted } from "./utils";

type ProductsViewProps = {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  taxes: CatalogTax[];
  isLoading: boolean;
  onReload: () => void;
  onCreate: (input: CatalogProductInput) => Promise<void>;
  onUpdate: (productId: string, input: CatalogProductInput) => Promise<void>;
  onDelete: (productId: string) => Promise<void>;
  onDuplicate: (productId: string) => Promise<void>;
};

export function ProductsView({
  products,
  categories,
  taxes,
  isLoading,
  onReload,
  onCreate,
  onUpdate,
  onDelete,
  onDuplicate,
}: ProductsViewProps) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [station, setStation] = useState("all");
  const [type, setType] = useState("all");
  const [availability, setAvailability] = useState("all");

  const stationOptions = useMemo(
    () => uniqueSorted(products.map((product) => product.station).filter(Boolean)),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        query.length === 0 ||
        [product.name, product.category, product.station, product.tax_code_name, product.product_type]
          .some((value) => value.toLowerCase().includes(query));
      const matchesCategory = categoryId === "all" || product.category_id === categoryId;
      const matchesStation = station === "all" || product.station === station;
      const matchesType = type === "all" || product.product_type === type;
      const matchesAvailability =
        availability === "all" ||
        (availability === "available" ? product.is_available : !product.is_available);

      return matchesSearch && matchesCategory && matchesStation && matchesType && matchesAvailability;
    });
  }, [availability, categoryId, products, search, station, type]);

  async function handleDelete(product: CatalogProduct) {
    if (!window.confirm(`Produkt "${product.name}" loeschen?`)) {
      return;
    }

    await onDelete(product.id);
  }

  return (
    <section className="rounded-md border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Produkte</h2>
          <p className="text-sm text-muted-foreground">Produkte erstellen, bearbeiten, kopieren und filtern.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={isLoading} onClick={onReload} type="button" variant="outline">
            <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} />
            Laden
          </Button>
          <ProductFormDialog categories={categories} mode="create" onSubmit={onCreate} taxes={taxes} />
        </div>
      </div>

      <CatalogFilters
        filters={[
          {
            id: "category",
            label: "Kategorie",
            value: categoryId,
            onChange: setCategoryId,
            options: [
              { label: "Alle Kategorien", value: "all" },
              ...categories.map((category) => ({ label: category.name, value: category.id })),
            ],
          },
          {
            id: "station",
            label: "Station",
            value: station,
            onChange: setStation,
            options: [
              { label: "Alle Stationen", value: "all" },
              ...stationOptions.map((option) => ({ label: option, value: option })),
            ],
          },
          {
            id: "type",
            label: "Typ",
            value: type,
            onChange: setType,
            options: [
              { label: "Alle Typen", value: "all" },
              { label: "BASIC", value: "BASIC" },
              { label: "SERVICE", value: "SERVICE" },
            ],
          },
          {
            id: "availability",
            label: "Verfuegbarkeit",
            value: availability,
            onChange: setAvailability,
            options: [
              { label: "Alle Status", value: "all" },
              { label: "Verfuegbar", value: "available" },
              { label: "Nicht verfuegbar", value: "unavailable" },
            ],
          },
        ]}
        onSearchChange={setSearch}
        search={search}
        searchPlaceholder="Produkt, Kategorie, Steuer oder Station suchen"
      />

      <div className="p-2 sm:p-3">
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kategorie</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead className="text-right">Preis</TableHead>
                <TableHead>Steuer</TableHead>
                <TableHead>Station</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell>{product.category}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{product.product_type}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(product.price)}</TableCell>
                  <TableCell>{product.tax_code_name}</TableCell>
                  <TableCell>{product.station}</TableCell>
                  <TableCell>
                    <Badge variant={product.is_available ? "secondary" : "destructive"}>
                      {product.is_available ? "Verfuegbar" : "Aus"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <ProductFormDialog
                        categories={categories}
                        mode="edit"
                        taxes={taxes}
                        onSubmit={(input) => onUpdate(product.id, input)}
                        product={product}
                      />
                      <DuplicateIconButton onClick={() => void onDuplicate(product.id)} />
                      <Button onClick={() => void handleDelete(product)} size="icon-sm" title="Loeschen" type="button" variant="ghost">
                        <Trash2 className="size-4" />
                        <span className="sr-only">Loeschen</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {!isLoading && filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={8}>
                    Keine Produkte gefunden.
                  </TableCell>
                </TableRow>
              ) : null}

              {isLoading ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={8}>
                    Produkte werden geladen.
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
