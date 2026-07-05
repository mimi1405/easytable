import {
  ArrowLeftIcon,
  BoxesIcon,
  ChevronUpIcon,
  LayoutGridIcon,
  ListIcon,
  ShoppingBasketIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@easytable/ui/components/drawer";
import { cn } from "@easytable/ui/lib/utils";

import type { StaffTableContext } from "../../layout/navigation";
import {
  createOrderSnapshotForConnection,
  detectConnectionMode,
  loadOpenTableOrderBasketForConnection,
  loadProductsForConnection,
  loadProductVariantGroupsForConnection,
  subscribeLocalMasterEvents,
  type BasketLine,
  type BasketLineVariant,
  type ConnectionMode,
  type ProductVariantGroup,
  type ProductVariantGroupItem,
  type StaffProduct,
} from "../../lib/local-master";
import { StaffBasket } from "./components/StaffBasket";
import { StaffVariantDrawer } from "./components/StaffVariantDrawer";
import { formatChf } from "./utils";
import {
  buildSelectedBasketVariants,
  getDefaultSelections,
} from "./variantSelection";

type StaffOrderScreenProps = {
  tableContext: StaffTableContext;
  onBackToTables: () => void;
};

type CatalogViewMode = "grid" | "list";

const allCategoryLabel = "Alle";

const productVisuals = [
  { tone: "from-slate-50 to-slate-100", accent: "text-slate-300" },
  { tone: "from-cyan-50 via-white to-indigo-100", accent: "text-cyan-700" },
  { tone: "from-stone-50 via-white to-amber-100", accent: "text-stone-600" },
  { tone: "from-neutral-50 via-white to-rose-100", accent: "text-rose-400" },
] as const;

export function StaffOrderScreen({ tableContext, onBackToTables }: StaffOrderScreenProps) {
  const [products, setProducts] = useState<StaffProduct[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(allCategoryLabel);
  const [catalogViewMode, setCatalogViewMode] = useState<CatalogViewMode>("grid");
  const [basketLines, setBasketLines] = useState<BasketLine[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<StaffProduct | null>(null);
  const [variantGroups, setVariantGroups] = useState<ProductVariantGroup[]>([]);
  const [activeVariantStep, setActiveVariantStep] = useState(0);
  const [selectedVariantItemsByGroupId, setSelectedVariantItemsByGroupId] = useState<Record<string, ProductVariantGroupItem>>({});
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [basketOpen, setBasketOpen] = useState(false);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("OFFLINE");

  const loadCatalogProducts = useCallback(async () => {
    if (connectionMode === "OFFLINE") {
      return;
    }

    try {
      const databaseProducts = await loadProductsForConnection(connectionMode);
      setProducts(databaseProducts.filter((product) => product.is_available));
    } catch (error) {
      console.warn("Could not load products from Local Master.", error);
    }
  }, [connectionMode]);

  useEffect(() => {
    let isMounted = true;

    async function refreshConnectionMode() {
      const nextMode = await detectConnectionMode();
      if (isMounted) {
        setConnectionMode(nextMode);
      }
    }

    void refreshConnectionMode();
    window.addEventListener("online", refreshConnectionMode);
    window.addEventListener("offline", refreshConnectionMode);
    document.addEventListener("visibilitychange", refreshConnectionMode);

    return () => {
      isMounted = false;
      window.removeEventListener("online", refreshConnectionMode);
      window.removeEventListener("offline", refreshConnectionMode);
      document.removeEventListener("visibilitychange", refreshConnectionMode);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialCatalogProducts() {
      try {
        if (connectionMode === "OFFLINE") {
          return;
        }

        const databaseProducts = await loadProductsForConnection(connectionMode);

        if (isMounted) {
          setProducts(databaseProducts.filter((product) => product.is_available));
        }
      } catch (error) {
        console.warn("Could not load products from Local Master.", error);
      }
    }

    void loadInitialCatalogProducts();

    return () => {
      isMounted = false;
    };
  }, [connectionMode]);

  useEffect(() => {
    if (connectionMode !== "LOCAL") {
      return undefined;
    }

    return subscribeLocalMasterEvents((event) => {
      if (event.type === "CATALOG_UPDATED") {
        void loadCatalogProducts();
      }
    });
  }, [connectionMode, loadCatalogProducts]);

  useEffect(() => {
    let isMounted = true;

    async function loadOpenBasket() {
      setBasketLines([]);
      setOrderNotice(null);

      try {
        if (connectionMode === "OFFLINE") {
          if (isMounted) {
            setBasketLines([]);
            setOrderNotice(null);
          }
          return;
        }

        const openBasket = await loadOpenTableOrderBasketForConnection(connectionMode, tableContext.table_id);

        if (isMounted) {
          setBasketLines(openBasket?.lines ?? []);
        }
      } catch (error) {
        console.warn("Could not load open table basket.", error);

        if (isMounted) {
          setBasketLines([]);
          setOrderNotice("Offener Tischauftrag konnte nicht geladen werden.");
        }
      }
    }

    void loadOpenBasket();

    return () => {
      isMounted = false;
    };
  }, [connectionMode, tableContext.table_id]);

  const productCards = useMemo(
    () =>
      products.map((product, index) => ({
        ...product,
        ...productVisuals[index % productVisuals.length],
      })),
    [products],
  );

  const productCategories = useMemo(
    () => [
      allCategoryLabel,
      ...Array.from(
        new Set(
          products
            .map((product) => product.category)
            .filter((category) => category.trim().length > 0),
        ),
      ),
    ],
    [products],
  );

  const filteredProductCards = useMemo(
    () =>
      selectedCategory === allCategoryLabel
        ? productCards
        : productCards.filter((product) => product.category === selectedCategory),
    [productCards, selectedCategory],
  );

  const basketTotal = basketLines.reduce((total, line) => total + line.line_total, 0);
  const selectedVariantTotal = Object.values(selectedVariantItemsByGroupId).reduce((total, item) => total + item.price_delta, 0);
  const drawerUnitTotal = selectedProduct ? selectedProduct.price + selectedVariantTotal : 0;

  async function handleProductPress(product: StaffProduct) {
    try {
      const groups = await loadProductVariantGroupsForConnection(connectionMode, product.id);

      if (groups.length === 0) {
        addProductToBasket(product, []);
        return;
      }

      setSelectedProduct(product);
      setVariantGroups(groups);
      setActiveVariantStep(0);
      setSelectedVariantItemsByGroupId(getDefaultSelections(groups));
    } catch (error) {
      console.warn("Adding product without variants after lookup failed.", error);
      addProductToBasket(product, []);
    }
  }

  function closeVariantDrawer() {
    setSelectedProduct(null);
    setVariantGroups([]);
    setActiveVariantStep(0);
    setSelectedVariantItemsByGroupId({});
  }

  function handleVariantBack() {
    if (activeVariantStep === 0) {
      closeVariantDrawer();
      return;
    }

    setActiveVariantStep((current) => current - 1);
  }

  function handlePrimaryDrawerAction() {
    if (!selectedProduct) {
      return;
    }

    if (activeVariantStep === variantGroups.length) {
      addProductToBasket(
        selectedProduct,
        buildSelectedBasketVariants(variantGroups, selectedVariantItemsByGroupId),
      );
      closeVariantDrawer();
      return;
    }

    const group = variantGroups[activeVariantStep];

    if (group.is_required && !selectedVariantItemsByGroupId[group.id]) {
      return;
    }

    setActiveVariantStep((current) => current + 1);
  }

  function handleVariantItemSelect(group: ProductVariantGroup, item: ProductVariantGroupItem) {
    if (group.selection_type !== "SINGLE") {
      return;
    }

    setSelectedVariantItemsByGroupId((current) => ({
      ...current,
      [group.id]: item,
    }));
  }

  function addProductToBasket(product: StaffProduct, variants: BasketLineVariant[]) {
    const unitTotal = product.price + variants.reduce((total, variant) => total + variant.price_delta, 0);
    const id = `${product.id}:${variants.map((variant) => variant.variant_item_id).join("|")}`;

    setBasketLines((current) => {
      const existingLine = current.find((line) => line.id === id);

      if (existingLine) {
        return current.map((line) =>
          line.id === id
            ? {
                ...line,
                quantity: line.quantity + 1,
                line_total: line.unit_total * (line.quantity + 1),
              }
            : line,
        );
      }

      return [
        ...current,
        {
          id,
          product_id: product.id,
          product_type: product.product_type,
          product_name: product.name,
          product_category: product.category,
          base_price: product.price,
          tax_code_id: product.tax_code_id,
          tax_code_name: product.tax_code_name,
          tax_rate_bps: product.tax_rate_bps,
          station: product.station,
          variants,
          unit_total: unitTotal,
          quantity: 1,
          line_total: unitTotal,
        },
      ];
    });
    setOrderNotice(null);
  }

  function decreaseBasketLine(lineId: string) {
    setBasketLines((current) =>
      current.flatMap((line) => {
        if (line.id !== lineId) {
          return [line];
        }

        if (line.quantity <= 1) {
          return [];
        }

        return [
          {
            ...line,
            quantity: line.quantity - 1,
            line_total: line.unit_total * (line.quantity - 1),
          },
        ];
      }),
    );
  }

  function removeBasketLine(lineId: string) {
    setBasketLines((current) => current.filter((line) => line.id !== lineId));
  }

  async function handleCreateOrderSnapshot() {
    if (basketLines.length === 0 || isCreatingOrder) {
      return;
    }

    setIsCreatingOrder(true);
    setOrderNotice(null);

    try {
      const order = await createOrderSnapshotForConnection(connectionMode, {
        lines: basketLines,
        table_context: tableContext,
      });

      setBasketLines([]);
      setBasketOpen(false);
      setOrderNotice(
        connectionMode === "RELAY"
          ? `Auftrag ${order.order_number} wurde via Relay angenommen.`
          : `Auftrag ${order.order_number} wurde gespeichert.`,
      );
    } catch (error) {
      console.error("Could not create order snapshot.", error);
      setOrderNotice(error instanceof Error ? error.message : "Auftrag konnte nicht gespeichert werden.");
    } finally {
      setIsCreatingOrder(false);
    }
  }

  return (
    <section className="mx-auto flex h-[calc(100svh-6.5rem)] max-w-6xl touch-manipulation flex-col overflow-hidden rounded-md border bg-[#f6f7fb] text-slate-950 shadow-sm">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="flex min-h-16 items-center gap-3 px-3 sm:px-4">
          <button
            aria-label="Zurück zum Tischplan"
            className="flex size-10 shrink-0 items-center justify-center rounded-md text-slate-500 transition active:scale-95 active:bg-slate-100"
            onClick={onBackToTables}
          >
            <ArrowLeftIcon className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black uppercase text-indigo-800">
              Tisch {tableContext.table_name} · {tableContext.area_name}
            </p>
            <p className="truncate text-[0.7rem] font-bold uppercase text-slate-400">
              {tableContext.floor_name} · {tableContext.seats} Sitzplätze
            </p>
          </div>
          <div className="hidden h-11 grid-cols-2 rounded-md border border-slate-200 bg-white p-1 shadow-sm sm:grid">
            <ModeButton active={catalogViewMode === "grid"} label="Raster" icon={LayoutGridIcon} onClick={() => setCatalogViewMode("grid")} />
            <ModeButton active={catalogViewMode === "list"} label="Liste" icon={ListIcon} onClick={() => setCatalogViewMode("list")} />
          </div>
          <ConnectionModeBadge mode={connectionMode} />
        </div>

        <nav className="flex gap-2 overflow-x-auto border-t border-slate-100 px-3 py-2 [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden">
          {productCategories.map((category) => (
            <button
              key={category}
              className={cn(
                "h-10 shrink-0 rounded-[2rem] px-4 text-sm font-extrabold uppercase tracking-normal transition active:scale-[0.98]",
                category === selectedCategory
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                  : "bg-slate-100 text-slate-500 active:bg-slate-200",
              )}
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </button>
          ))}
        </nav>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-28 pt-3 sm:px-4 sm:pb-4">
          {catalogViewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
              {filteredProductCards.map((product, index) => (
                <button
                  key={product.id}
                  className="group flex aspect-[1.04] min-h-36 flex-col overflow-hidden rounded-md bg-white text-left shadow-md shadow-slate-200/80 ring-1 ring-slate-200 transition active:scale-[0.985]"
                  onClick={() => void handleProductPress(product)}
                >
                  <div className={`relative flex flex-1 items-center justify-center bg-gradient-to-br ${product.tone}`}>
                    <div className={`flex size-14 items-center justify-center rounded-md bg-white/50 sm:size-16 ${product.accent}`}>
                      <BoxesIcon className="size-9 sm:size-11" />
                    </div>
                  </div>
                  <div className="flex min-h-16 items-end justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950 sm:text-base">{product.name}</p>
                      <p className="text-sm font-extrabold text-slate-500">{formatChf(product.price)}</p>
                    </div>
                    {index > 1 ? (
                      <span className="hidden shrink-0 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-black text-indigo-700 sm:block">
                        Varianten
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredProductCards.map((product) => (
                <button
                  key={product.id}
                  className="flex min-h-20 items-center gap-3 rounded-md bg-white px-4 text-left shadow-sm ring-1 ring-slate-200 transition active:scale-[0.99] active:bg-slate-50"
                  onClick={() => void handleProductPress(product)}
                >
                  <div className={`flex size-14 shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${product.tone}`}>
                    <BoxesIcon className={`size-7 ${product.accent}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-black text-slate-950">{product.name}</p>
                    <p className="truncate text-xs font-black uppercase text-slate-400">{product.category}</p>
                  </div>
                  <p className="shrink-0 text-base font-black text-slate-950">{formatChf(product.price)}</p>
                </button>
              ))}
            </div>
          )}

          {filteredProductCards.length === 0 ? (
            <div className="flex min-h-[40svh] items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/60 px-6 text-center">
              <p className="max-w-sm text-sm font-black uppercase text-slate-400">Keine Produkte im Katalog</p>
            </div>
          ) : null}
        </div>

        <div className="hidden min-h-0 md:block">
          <StaffBasket
            lines={basketLines}
            total={basketTotal}
            isSubmitting={isCreatingOrder}
            onDecreaseLine={decreaseBasketLine}
            onRemoveLine={removeBasketLine}
            onCreateOrder={() => void handleCreateOrderSnapshot()}
          />
        </div>
      </div>

      <button
        className="fixed inset-x-3 bottom-4 z-30 flex h-16 items-center justify-between rounded-md bg-slate-950 px-4 text-left text-white shadow-xl shadow-slate-900/25 transition active:scale-[0.99] md:hidden"
        onClick={() => setBasketOpen(true)}
      >
        <span className="flex min-w-0 items-center gap-3">
          <ShoppingBasketIcon className="size-5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-black uppercase">{basketLines.length} Positionen</span>
            <span className="block text-xs font-bold text-slate-300">Warenkorb öffnen</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-sm font-black">
          {formatChf(basketTotal)}
          <ChevronUpIcon className="size-5" />
        </span>
      </button>

      <Drawer open={basketOpen} onOpenChange={setBasketOpen}>
        <DrawerContent className="h-[min(82svh,42rem)] max-h-[82svh] rounded-t-md bg-white">
          <DrawerHeader className="shrink-0 border-b border-slate-200 px-5 py-4 text-left">
            <DrawerTitle className="text-base font-black">Warenkorb</DrawerTitle>
            <DrawerDescription className="sr-only">Ausgewählte Produkte für den Tisch</DrawerDescription>
          </DrawerHeader>
          <StaffBasket
            compact
            lines={basketLines}
            total={basketTotal}
            isSubmitting={isCreatingOrder}
            onDecreaseLine={decreaseBasketLine}
            onRemoveLine={removeBasketLine}
            onCreateOrder={() => void handleCreateOrderSnapshot()}
          />
        </DrawerContent>
      </Drawer>

      <StaffVariantDrawer
        open={selectedProduct !== null}
        product={selectedProduct}
        groups={variantGroups}
        activeStep={activeVariantStep}
        selectedItemsByGroupId={selectedVariantItemsByGroupId}
        unitTotal={drawerUnitTotal}
        onOpenChange={(open) => {
          if (!open) {
            closeVariantDrawer();
          }
        }}
        onBack={handleVariantBack}
        onPrimaryAction={handlePrimaryDrawerAction}
        onSelectItem={handleVariantItemSelect}
      />

      {orderNotice ? (
        <div className="fixed bottom-24 left-4 right-4 z-40 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-lg shadow-slate-900/10 sm:right-auto sm:max-w-sm md:bottom-6">
          {orderNotice}
        </div>
      ) : null}
    </section>
  );
}

function ConnectionModeBadge({ mode }: { mode: ConnectionMode }) {
  const isLocal = mode === "LOCAL";
  const isRelay = mode === "RELAY";
  const Icon = mode === "OFFLINE" ? WifiOffIcon : WifiIcon;

  return (
    <div
      className={cn(
        "hidden h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-black uppercase sm:flex",
        isLocal
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : isRelay
            ? "border-indigo-200 bg-indigo-50 text-indigo-700"
            : "border-rose-200 bg-rose-50 text-rose-700",
      )}
    >
      <Icon className="size-4" />
      {isLocal ? "Lokal" : isRelay ? "Relay" : "Offline"}
    </div>
  );
}

function ModeButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof LayoutGridIcon;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex min-w-24 items-center justify-center gap-2 rounded px-3 text-sm font-black uppercase transition active:scale-[0.98]",
        active ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 active:bg-slate-100",
      )}
      onClick={onClick}
    >
      <Icon className="size-5" />
      {label}
    </button>
  );
}
