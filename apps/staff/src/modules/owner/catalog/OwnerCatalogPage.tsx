import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

import { Button } from "@easytable/ui/components/button";

import {
  createCatalogCategory,
  createCatalogProduct,
  createCatalogTax,
  deleteCatalogCategory,
  deleteCatalogProduct,
  deleteCatalogTax,
  duplicateCatalogCategory,
  duplicateCatalogProduct,
  duplicateCatalogTax,
  getLocalMasterUrl,
  loadCatalog,
  loadCatalogCategories,
  loadCatalogTaxes,
  updateCatalogCategory,
  updateCatalogProduct,
  updateCatalogTax,
  type CatalogCategory,
  type CatalogProduct,
  type CatalogTax,
} from "../../../lib/local-master";
import type { OwnerCatalogSection } from "../../../layout/navigation";
import { CategoriesView } from "./CategoriesView";
import { ProductsView } from "./ProductsView";
import { TaxView } from "./TaxView";

type OwnerCatalogPageProps = {
  section: OwnerCatalogSection;
};

export function OwnerCatalogPage({ section }: OwnerCatalogPageProps) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [taxes, setTaxes] = useState<CatalogTax[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshCatalog() {
    setIsLoading(true);
    setError(null);

    try {
      const [nextProducts, nextCategories, nextTaxes] = await Promise.all([
        loadCatalog(),
        loadCatalogCategories(),
        loadCatalogTaxes(),
      ]);
      setProducts(nextProducts);
      setCategories(nextCategories);
      setTaxes(nextTaxes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Katalog konnte nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  }

  async function runAction(action: () => Promise<void>) {
    setError(null);

    try {
      await action();
      await refreshCatalog();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Aktion fehlgeschlagen.");
      throw actionError;
    }
  }

  useEffect(() => {
    void refreshCatalog();
  }, []);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-md border bg-card p-4 text-card-foreground shadow-sm sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Owner / Katalog</p>
          <h2 className="text-2xl font-semibold tracking-normal">{sectionTitle(section)}</h2>
        </div>
        <span className="max-w-full truncate rounded-md border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
          {getLocalMasterUrl()}
        </span>
      </section>

      {error ? <ErrorBanner message={error} onRetry={refreshCatalog} /> : null}

      {section === "products" ? (
        <ProductsView
          categories={categories}
          isLoading={isLoading}
          onCreate={(input) => runAction(async () => void (await createCatalogProduct(input)))}
          onDelete={(productId) => runAction(async () => void (await deleteCatalogProduct(productId)))}
          onDuplicate={(productId) => runAction(async () => void (await duplicateCatalogProduct(productId)))}
          onReload={refreshCatalog}
          onUpdate={(productId, input) => runAction(async () => void (await updateCatalogProduct(productId, input)))}
          products={products}
          taxes={taxes}
        />
      ) : section === "categories" ? (
        <CategoriesView
          categories={categories}
          isLoading={isLoading}
          onCreate={(input) => runAction(async () => void (await createCatalogCategory(input)))}
          onDelete={(categoryId) => runAction(async () => void (await deleteCatalogCategory(categoryId)))}
          onDuplicate={(categoryId) => runAction(async () => void (await duplicateCatalogCategory(categoryId)))}
          onReload={refreshCatalog}
          onUpdate={(categoryId, input) => runAction(async () => void (await updateCatalogCategory(categoryId, input)))}
        />
      ) : (
        <TaxView
          isLoading={isLoading}
          onCreate={(input) => runAction(async () => void (await createCatalogTax(input)))}
          onDelete={(taxId) => runAction(async () => void (await deleteCatalogTax(taxId)))}
          onDuplicate={(taxId) => runAction(async () => void (await duplicateCatalogTax(taxId)))}
          onReload={refreshCatalog}
          onUpdate={(taxId, input) => runAction(async () => void (await updateCatalogTax(taxId, input)))}
          taxes={taxes}
        />
      )}
    </div>
  );
}

function sectionTitle(section: OwnerCatalogSection) {
  if (section === "products") {
    return "Produkte";
  }

  return section === "categories" ? "Kategorien" : "Steuern";
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-destructive sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <WifiOff className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">Katalogaktion fehlgeschlagen</p>
          <p className="break-words text-sm opacity-80">{message}</p>
        </div>
      </div>
      <Button onClick={onRetry} type="button" variant="outline">
        Erneut laden
      </Button>
    </div>
  );
}