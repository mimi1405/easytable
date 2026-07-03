import {
  ArrowLeftIcon,
  BoxesIcon,
  DoorOpenIcon,
  EllipsisIcon,
  LayoutGridIcon,
  ListIcon,
  ShoppingBagIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { PosScreen } from "../App";
import {
  completeMockPayment,
  createOrderSnapshot,
  getStoredTerminalConfig,
  loadOpenTableOrderBasket,
  loadProductVariantGroups,
  loadProducts as loadCatalogProducts,
  subscribeLocalMasterEvents,
} from "../lib/local-master-client";
import { formatChf } from "../lib/money";
import type {
  BasketLine,
  BasketLineVariant,
  MockPaymentRequest,
  PosProduct,
  ProductCard,
  ProductVariantGroup,
  ProductVariantGroupItem,
  LocationServiceMode,
  TableContext,
} from "../lib/pos-types";
import { BasketPanel } from "./cash-register/BasketPanel";
import { PaymentScreen } from "./cash-register/PaymentScreen";
import { VariantSelectionDrawer } from "./cash-register/VariantSelectionDrawer";
import {
  buildSelectedBasketVariants,
  getDefaultSelections,
} from "./cash-register/variantSelection";

type CashRegisterScreenProps = {
  serviceMode: LocationServiceMode;
  tableContext: TableContext | null;
  onNavigate: (screen: PosScreen) => void;
  onOrderCreated: () => void;
};

const navItems = [
  { label: "Kasse", icon: ShoppingBagIcon, screen: "cash", active: true },
  { label: "Mehr", icon: EllipsisIcon, screen: "more", active: false },
  { label: "Abmelden", icon: DoorOpenIcon, screen: "logout", active: false },
] as const satisfies readonly {
  label: string;
  icon: typeof ShoppingBagIcon;
  screen: PosScreen;
  active: boolean;
}[];

const allCategoryLabel = "Alle";
type CatalogViewMode = "grid" | "list";

const productVisuals = [
  {
    tone: "from-slate-50 to-slate-100",
    accent: "text-slate-300",
  },
  {
    tone: "from-zinc-50 to-slate-100",
    accent: "text-slate-300",
  },
  {
    tone: "from-cyan-50 via-white to-indigo-100",
    accent: "text-cyan-700",
  },
  {
    tone: "from-stone-50 via-white to-amber-100",
    accent: "text-stone-600",
  },
  {
    tone: "from-neutral-50 via-white to-rose-100",
    accent: "text-rose-400",
  },
] as const;

export function CashRegisterScreen({
  serviceMode,
  tableContext,
  onNavigate,
  onOrderCreated,
}: CashRegisterScreenProps) {
  const showTopRegion = true;
  const isCounterService = serviceMode === "COUNTER_SERVICE";
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(allCategoryLabel);
  const [catalogViewMode, setCatalogViewMode] =
    useState<CatalogViewMode>("grid");
  const [basketLines, setBasketLines] = useState<BasketLine[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductCard | null>(
    null,
  );
  const [variantGroups, setVariantGroups] = useState<ProductVariantGroup[]>([]);
  const [activeVariantStep, setActiveVariantStep] = useState(0);
  const [selectedVariantItemsByGroupId, setSelectedVariantItemsByGroupId] =
    useState<Record<string, ProductVariantGroupItem>>({});
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isCompletingPayment, setIsCompletingPayment] = useState(false);
  const [isPaymentScreenOpen, setIsPaymentScreenOpen] = useState(false);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const databaseProducts = await loadCatalogProducts();
      setProducts(databaseProducts);
    } catch (error) {
      console.warn("Could not load products from Local Master.", error);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialProducts() {
      try {
        const databaseProducts = await loadCatalogProducts();

        if (isMounted) {
          setProducts(databaseProducts);
        }
      } catch (error) {
        console.warn("Could not load products from Local Master.", error);
      }
    }

    void loadInitialProducts();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return subscribeLocalMasterEvents((event) => {
      if (event.type === "CATALOG_UPDATED") {
        void loadProducts();
      }
    });
  }, [loadProducts]);

  useEffect(() => {
    let isMounted = true;

    async function loadOpenTableBasket() {
      if (!tableContext) {
        setBasketLines([]);
        return;
      }

      setBasketLines([]);
      setIsPaymentScreenOpen(false);
      setOrderNotice(null);

      try {
        const openBasket = await loadOpenTableOrderBasket(tableContext.table_id);

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

    void loadOpenTableBasket();

    return () => {
      isMounted = false;
    };
  }, [tableContext]);

  const productCards = useMemo<ProductCard[]>(
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

  const basketTotal = basketLines.reduce(
    (total, line) => total + line.line_total,
    0,
  );
  const selectedVariantTotal = Object.values(
    selectedVariantItemsByGroupId,
  ).reduce((total, item) => total + item.price_delta, 0);
  const drawerUnitTotal = selectedProduct
    ? selectedProduct.price + selectedVariantTotal
    : 0;

  async function handleProductPress(product: ProductCard) {
    try {
      const groups = await loadProductVariantGroups(product.id);

      if (groups.length === 0) {
        addProductToBasket(product, []);
        return;
      }

      openVariantDrawer(product, groups);
    } catch (error) {
      console.warn("Adding product without variants after lookup failed.", error);
      addProductToBasket(product, []);
    }
  }

  function openVariantDrawer(product: ProductCard, groups: ProductVariantGroup[]) {
    setSelectedProduct(product);
    setVariantGroups(groups);
    setActiveVariantStep(0);
    setSelectedVariantItemsByGroupId(getDefaultSelections(groups));
  }

  function closeVariantDrawer() {
    setSelectedProduct(null);
    setVariantGroups([]);
    setActiveVariantStep(0);
    setSelectedVariantItemsByGroupId({});
  }

  function handleDrawerOpenChange(open: boolean) {
    if (!open) {
      closeVariantDrawer();
    }
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

  function handleVariantItemSelect(
    group: ProductVariantGroup,
    item: ProductVariantGroupItem,
  ) {
    if (group.selection_type !== "SINGLE") {
      return;
    }

    setSelectedVariantItemsByGroupId((current) => ({
      ...current,
      [group.id]: item,
    }));
  }

  function addProductToBasket(
    product: ProductCard,
    variants: BasketLineVariant[],
  ) {
    const unitTotal =
      product.price +
      variants.reduce((total, variant) => total + variant.price_delta, 0);
    const id = `${product.id}:${variants
      .map((variant) => variant.variant_item_id)
      .join("|")}`;

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
    if (basketLines.length === 0 || isCreatingOrder || isCompletingPayment) {
      return;
    }

    if (!tableContext) {
      setOrderNotice("Bitte zuerst einen Tisch auswahlen.");
      return;
    }

    setIsCreatingOrder(true);
    setOrderNotice(null);

    try {
      const order = await createOrderSnapshot({
        lines: basketLines,
        table_context: tableContext,
      });

      setBasketLines([]);
      setOrderNotice(`Auftrag ${order.order_number} wurde gespeichert.`);
      onOrderCreated();
    } catch (error) {
      console.error("Could not create order snapshot.", error);
      setOrderNotice(
        error instanceof Error
          ? error.message
          : "Auftrag konnte nicht gespeichert werden.",
      );
    } finally {
      setIsCreatingOrder(false);
    }
  }

  function handleStartPayment() {
    if (basketLines.length === 0 || isCreatingOrder || isCompletingPayment) {
      return;
    }

    if (!tableContext && !isCounterService) {
      setOrderNotice("Bitte zuerst einen Tisch auswahlen.");
      return;
    }

    setOrderNotice(null);
    setIsPaymentScreenOpen(true);
  }

  async function handleCompleteMockPayment(paymentRequest: MockPaymentRequest) {
    if (basketLines.length === 0 || isCompletingPayment) {
      return;
    }

    if (!tableContext && !isCounterService) {
      return;
    }

    setIsCompletingPayment(true);
    setOrderNotice(null);

    try {
      const payment = await completeMockPayment({
        lines: basketLines,
        table_context: tableContext,
        terminal_id: getStoredTerminalConfig()?.terminalId ?? "pos-shell",
        ...paymentRequest,
      });

      setBasketLines([]);
      setIsPaymentScreenOpen(false);
      setOrderNotice(
        `Auftrag ${payment.order_number} wurde bezahlt (${formatChf(payment.amount)}).`,
      );
      onOrderCreated();
    } catch (error) {
      console.error("Could not complete mock payment.", error);
      setIsPaymentScreenOpen(false);
      setOrderNotice(
        error instanceof Error
          ? error.message
          : "Mock-Zahlung konnte nicht abgeschlossen werden.",
      );
    } finally {
      setIsCompletingPayment(false);
    }
  }

  if (isPaymentScreenOpen) {
    return (
      <PaymentScreen
        total={basketTotal}
        isSubmitting={isCompletingPayment}
        onCancel={() => setIsPaymentScreenOpen(false)}
        onSelectMethod={(payment) => void handleCompleteMockPayment(payment)}
      />
    );
  }

  return (
    <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-[#f6f7fb] text-slate-950">
      {showTopRegion ? (
        <header className="shrink-0 border-b border-slate-200 bg-white">
          <div className="grid h-[clamp(4rem,10svh,6.5rem)] grid-cols-[minmax(0,1fr)_clamp(15rem,24vw,22rem)]">
            <section className="flex min-w-0 items-center gap-3 px-4">
              <button
                className="flex size-10 shrink-0 items-center justify-center rounded-md text-slate-500 transition active:scale-95 active:bg-slate-100"
                aria-label="Zuruck"
                onClick={() => onNavigate("tables")}
              >
                <ArrowLeftIcon className="size-5" />
              </button>
              <nav className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {productCategories.map((category) => (
                  <button
                    key={category}
                    className={[
                      "h-10 shrink-0 rounded-[2rem] px-4 text-sm font-extrabold uppercase tracking-normal transition active:scale-[0.98]",
                      category === selectedCategory
                        ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                        : "bg-slate-100 text-slate-500 active:bg-slate-200",
                    ].join(" ")}
                    onClick={() => setSelectedCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </nav>
            </section>

            <aside className="flex min-w-0 flex-col justify-center border-l border-slate-200 bg-slate-50 px-5">
              <p className="truncate text-sm font-black uppercase text-indigo-800">
                {tableContext
                  ? `Tisch ${tableContext.table_name} Â· ${tableContext.area_name}`
                  : isCounterService
                    ? "Counterbetrieb"
                    : "Tischbetrieb"}
              </p>
              <p className="truncate text-[0.7rem] font-bold uppercase text-slate-400">
                {basketLines.length === 0
                  ? tableContext
                    ? `${tableContext.floor_name} Â· ${tableContext.seats} Sitzplatze`
                    : isCounterService
                      ? "Direktverkauf"
                      : "Keine Artikel gewahlt"
                  : `${basketLines.length} Positionen`}
              </p>
            </aside>
          </div>
        </header>
      ) : null}

      <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(15rem,24vw,22rem)] overflow-hidden">
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="mb-4 flex justify-end">
            <div className="grid h-12 grid-cols-2 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
              <button
                className={[
                  "flex min-w-28 items-center justify-center gap-2 rounded px-3 text-sm font-black uppercase transition active:scale-[0.98]",
                  catalogViewMode === "grid"
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-500 active:bg-slate-100",
                ].join(" ")}
                onClick={() => setCatalogViewMode("grid")}
              >
                <LayoutGridIcon className="size-5" />
                Raster
              </button>
              <button
                className={[
                  "flex min-w-28 items-center justify-center gap-2 rounded px-3 text-sm font-black uppercase transition active:scale-[0.98]",
                  catalogViewMode === "list"
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-500 active:bg-slate-100",
                ].join(" ")}
                onClick={() => setCatalogViewMode("list")}
              >
                <ListIcon className="size-5" />
                Liste
              </button>
            </div>
          </div>

          {catalogViewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredProductCards.map((product, index) => (
                <button
                  key={product.id}
                  className="group flex aspect-[1.08] min-h-44 flex-col overflow-hidden rounded-md bg-white text-left shadow-md shadow-slate-200/80 ring-1 ring-slate-200 transition active:scale-[0.985]"
                  onClick={() => void handleProductPress(product)}
                >
                  <div
                    className={`relative flex flex-1 items-center justify-center bg-gradient-to-br ${product.tone}`}
                  >
                    {index < 2 ? (
                      <BoxesIcon className="size-16 text-slate-300" />
                    ) : (
                      <div
                        className={`flex size-20 items-center justify-center rounded-md bg-white/50 ${product.accent}`}
                      >
                        <BoxesIcon className="size-14" />
                      </div>
                    )}
                  </div>
                  <div className="flex min-h-16 items-end justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-slate-950">
                        {product.name}
                      </p>
                      <p className="text-sm font-extrabold text-slate-500">
                        {formatChf(product.price)}
                      </p>
                    </div>
                    {index > 1 ? (
                      <span className="shrink-0 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-black text-indigo-700">
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
                  <div
                    className={`flex size-14 shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${product.tone}`}
                  >
                    <BoxesIcon className={`size-7 ${product.accent}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-black text-slate-950">
                      {product.name}
                    </p>
                    <p className="truncate text-xs font-black uppercase text-slate-400">
                      {product.category}
                    </p>
                  </div>
                  <p className="shrink-0 text-lg font-black text-slate-950">
                    {formatChf(product.price)}
                  </p>
                </button>
              ))}
            </div>
          )}

          {filteredProductCards.length === 0 ? (
            <div className="flex min-h-[45svh] items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/60 px-6 text-center">
              <p className="max-w-sm text-sm font-black uppercase text-slate-400">
                Keine Produkte im Katalog
              </p>
            </div>
          ) : null}
        </div>

        <BasketPanel
          lines={basketLines}
          total={basketTotal}
          isSubmitting={isCreatingOrder || isCompletingPayment}
          bookLabel="Buchen"
          payLabel="Bezahlen"
          showBookAction={!isCounterService}
          onDecreaseLine={decreaseBasketLine}
          onRemoveLine={removeBasketLine}
          onCreateOrder={() => void handleCreateOrderSnapshot()}
          onStartPayment={handleStartPayment}
        />
      </section>

      {orderNotice ? (
        <div className="fixed bottom-20 left-4 max-w-sm rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-lg shadow-slate-900/10">
          {orderNotice}
        </div>
      ) : null}

      <footer className="grid h-16 shrink-0 grid-cols-3 border-t border-slate-200 bg-white">
        {navItems.map(({ label, icon: Icon, screen, active }) => (
          <button
            key={label}
            className={[
              "flex flex-col items-center justify-center gap-0.5 text-xs font-black uppercase transition active:bg-slate-100",
              active ? "text-indigo-800" : "text-slate-500",
            ].join(" ")}
            onClick={() => onNavigate(screen)}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </footer>

      <VariantSelectionDrawer
        open={selectedProduct !== null}
        product={selectedProduct}
        groups={variantGroups}
        activeStep={activeVariantStep}
        selectedItemsByGroupId={selectedVariantItemsByGroupId}
        unitTotal={drawerUnitTotal}
        onOpenChange={handleDrawerOpenChange}
        onBack={handleVariantBack}
        onPrimaryAction={handlePrimaryDrawerAction}
        onSelectItem={handleVariantItemSelect}
      />
    </main>
  );
}



