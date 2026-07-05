import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

import { Button } from "@easytable/ui/components/button";

import {
  detectConnectionMode,
  getLocalMasterUrl,
  getRelaySyncUrl,
  loadOwnerCatalogForConnection,
  runOwnerCatalogActionForConnection,
  type CatalogCategory,
  type CatalogOutputStation,
  type CatalogProduct,
  type CatalogTax,
  type ConnectionMode,
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
  const [outputStations, setOutputStations] = useState<CatalogOutputStation[]>([]);
  const [taxes, setTaxes] = useState<CatalogTax[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("OFFLINE");

  async function refreshCatalog() {
    setIsLoading(true);
    setError(null);

    try {
      const nextMode = await detectConnectionMode();
      setConnectionMode(nextMode);
      const snapshot = await loadOwnerCatalogForConnection(nextMode);
      setProducts(snapshot.products);
      setCategories(snapshot.categories);
      setTaxes(snapshot.taxes);
      setOutputStations(snapshot.output_stations);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Katalog konnte nicht geladen werden.");
    } finally {
      setIsLoading(false);
    }
  }

  async function runAction(action: string, payload: unknown) {
    setError(null);

    try {
      await runOwnerCatalogActionForConnection(connectionMode, action, payload);
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
          {connectionMode === "RELAY" ? getRelaySyncUrl() : getLocalMasterUrl()}
        </span>
      </section>

      {error ? <ErrorBanner message={error} onRetry={refreshCatalog} /> : null}

      {section === "products" ? (
        <ProductsView
          categories={categories}
          isLoading={isLoading}
          onCreate={(input) => runAction("OWNER_CATALOG_PRODUCT_CREATE", input)}
          onDelete={(productId) => runAction("OWNER_CATALOG_PRODUCT_DELETE", { product_id: productId })}
          onDuplicate={(productId) => runAction("OWNER_CATALOG_PRODUCT_DUPLICATE", { product_id: productId })}
          onReload={refreshCatalog}
          onUpdate={(productId, input) => runAction("OWNER_CATALOG_PRODUCT_UPDATE", { product_id: productId, input })}
          outputStations={outputStations}
          products={products}
          taxes={taxes}
        />
      ) : section === "categories" ? (
        <CategoriesView
          categories={categories}
          isLoading={isLoading}
          onCreate={(input) => runAction("OWNER_CATALOG_CATEGORY_CREATE", input)}
          onDelete={(categoryId) => runAction("OWNER_CATALOG_CATEGORY_DELETE", { category_id: categoryId })}
          onDuplicate={(categoryId) => runAction("OWNER_CATALOG_CATEGORY_DUPLICATE", { category_id: categoryId })}
          onReload={refreshCatalog}
          onUpdate={(categoryId, input) => runAction("OWNER_CATALOG_CATEGORY_UPDATE", { category_id: categoryId, input })}
          outputStations={outputStations}
        />
      ) : (
        <TaxView
          isLoading={isLoading}
          onCreate={(input) => runAction("OWNER_CATALOG_TAX_CREATE", input)}
          onDelete={(taxId) => runAction("OWNER_CATALOG_TAX_DELETE", { tax_id: taxId })}
          onDuplicate={(taxId) => runAction("OWNER_CATALOG_TAX_DUPLICATE", { tax_id: taxId })}
          onReload={refreshCatalog}
          onUpdate={(taxId, input) => runAction("OWNER_CATALOG_TAX_UPDATE", { tax_id: taxId, input })}
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
