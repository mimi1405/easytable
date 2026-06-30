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

import type { CatalogCategory, CatalogCategoryInput } from "../../../lib/local-master";
import { CatalogFilters } from "./components/CatalogFilters";
import { CategoryFormDialog, DuplicateCategoryButton } from "./components/CategoryFormDialog";

type CategoriesViewProps = {
  categories: CatalogCategory[];
  isLoading: boolean;
  onReload: () => void;
  onCreate: (input: CatalogCategoryInput) => Promise<void>;
  onUpdate: (categoryId: string, input: CatalogCategoryInput) => Promise<void>;
  onDelete: (categoryId: string) => Promise<void>;
  onDuplicate: (categoryId: string) => Promise<void>;
};

export function CategoriesView({
  categories,
  isLoading,
  onReload,
  onCreate,
  onUpdate,
  onDelete,
  onDuplicate,
}: CategoriesViewProps) {
  const [search, setSearch] = useState("");

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return categories;
    }

    return categories.filter((category) => category.name.toLowerCase().includes(query));
  }, [categories, search]);

  async function handleDelete(category: CatalogCategory) {
    const message = category.product_count > 0
      ? `Kategorie "${category.name}" hat noch ${category.product_count} Produkte. Loeschen versuchen?`
      : `Kategorie "${category.name}" loeschen?`;

    if (!window.confirm(message)) {
      return;
    }

    await onDelete(category.id);
  }

  return (
    <section className="rounded-md border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Kategorien</h2>
          <p className="text-sm text-muted-foreground">Kategorien erstellen, umbenennen, kopieren und loeschen.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={isLoading} onClick={onReload} type="button" variant="outline">
            <RefreshCw className={isLoading ? "size-4 animate-spin" : "size-4"} />
            Laden
          </Button>
          <CategoryFormDialog mode="create" onSubmit={onCreate} />
        </div>
      </div>

      <CatalogFilters
        onSearchChange={setSearch}
        search={search}
        searchPlaceholder="Kategorie suchen"
      />

      <div className="p-2 sm:p-3">
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Produkte</TableHead>
                <TableHead className="text-right">Sortierung</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCategories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium">{category.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{category.product_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{category.sort_order}</TableCell>
                  <TableCell>
                    <Badge variant={category.product_count > 0 ? "secondary" : "outline"}>
                      {category.product_count > 0 ? "In Nutzung" : "Leer"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <CategoryFormDialog
                        category={category}
                        mode="edit"
                        onSubmit={(input) => onUpdate(category.id, input)}
                      />
                      <DuplicateCategoryButton onClick={() => void onDuplicate(category.id)} />
                      <Button onClick={() => void handleDelete(category)} size="icon-sm" title="Loeschen" type="button" variant="ghost">
                        <Trash2 className="size-4" />
                        <span className="sr-only">Loeschen</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {!isLoading && filteredCategories.length === 0 ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                    Keine Kategorien gefunden.
                  </TableCell>
                </TableRow>
              ) : null}

              {isLoading ? (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                    Kategorien werden geladen.
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
