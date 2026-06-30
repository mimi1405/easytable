import { readState, writeState } from "./statePersistence.js";
import { randomUUID } from "node:crypto";
import { getProductById, listProducts as listCatalogProducts } from "./catalogStore.js";

import type {
  BasketLine,
  CompleteMockPaymentRequest,
  CurrentBusinessDate,
  CurrentBusinessDateRequest,
  DayClosePreview,
  DayClosePreviewRequest,
  DayCloseProductSale,
  CompletedMockPayment,
  CreatedOrderSnapshot,
  CreateOrderSnapshotRequest,
  OpenTableOrderBasket,
  Order,
  OrderDraft,
  PosSettingsFile,
  ProductVariantGroup,
  ProductVariantGroupItem,
  Table,
  SaveDayCloseRequest,
  SavedDayClose,
  TableContext,
  TableLayout,
  TableLayoutArea,
  TableLayoutFloor,
  TableLayoutTable
} from "./types.js";

// Mirrors apps/pos-shell/src-tauri/src/seeds.rs until migrations move into localMaster.
const tenant = { id: "tenant_basilica", name: "Basilica" };
const location = { id: "loc_basilica_main", tenant_id: tenant.id, name: "Basilica" };

const floors: Array<Omit<TableLayoutFloor, "areas">> = [
  { id: "floor_basilica_eg", location_id: location.id, name: "EG", sort_order: 10 },
  { id: "floor_basilica_og", location_id: location.id, name: "OG", sort_order: 20 }
];

const areas: Array<Omit<TableLayoutArea, "tables">> = [
  { id: "area_basilica_bar", floor_id: "floor_basilica_eg", name: "Bar", sort_order: 10 },
  { id: "area_basilica_fumoir", floor_id: "floor_basilica_eg", name: "Fumoir", sort_order: 20 },
  { id: "area_basilica_lounges", floor_id: "floor_basilica_eg", name: "Lounges", sort_order: 30 },
  { id: "area_basilica_raucherlounge", floor_id: "floor_basilica_eg", name: "Raucherlounge", sort_order: 40 },
  { id: "area_basilica_og_lounge", floor_id: "floor_basilica_og", name: "Lounge", sort_order: 10 }
];

const layoutTables: Array<Omit<TableLayoutTable, "open_order_id" | "open_order_number" | "open_total" | "open_order_count">> = [
  { id: "table_basilica_fumoir_2", area_id: "area_basilica_fumoir", name: "2", seats: 4, sort_order: 10 },
  { id: "table_basilica_fumoir_3", area_id: "area_basilica_fumoir", name: "3", seats: 4, sort_order: 20 },
  { id: "table_basilica_bar_1", area_id: "area_basilica_bar", name: "1", seats: 2, sort_order: 10 },
  { id: "table_basilica_lounges_10", area_id: "area_basilica_lounges", name: "10", seats: 6, sort_order: 10 },
  { id: "table_basilica_raucherlounge_20", area_id: "area_basilica_raucherlounge", name: "20", seats: 8, sort_order: 10 },
  { id: "table_basilica_og_30", area_id: "area_basilica_og_lounge", name: "30", seats: 4, sort_order: 10 }
];

const variantGroups: ProductVariantGroup[] = [
  {
    id: "vgrp_shisha_standard_head",
    applies_to: "CATEGORY",
    product_id: null,
    category: "Shisha",
    name: "Head",
    selection_type: "SINGLE",
    min_select: 1,
    max_select: 1,
    sort_order: 10,
    is_required: true,
    items: [
      createVariantItem("vitem_shisha_standard_head_standard", "vgrp_shisha_standard_head", "Standard", 0, true, 10),
      createVariantItem("vitem_shisha_standard_head_silver", "vgrp_shisha_standard_head", "Silver", 500, false, 20),
      createVariantItem("vitem_shisha_standard_head_premium", "vgrp_shisha_standard_head", "Premium", 1000, false, 30)
    ]
  }
];

const staffOrders = readState<Order[]>("staffOrders", []);
const posOrders = readState<PosOrderSnapshot[]>("posOrders", []);
const payments = readState<LocalPayment[]>("payments", []);
const dayCloses = new Map<string, StoredDayClose>(readState<Array<[string, StoredDayClose]>>("dayCloses", []));
let nextPosOrderNumber = 1;

const posSettings: PosSettingsFile = {
  path: "local-master://settings/pos-settings.json",
  settings: {
    schema_version: 1,
    tenant_id: tenant.id,
    location_id: location.id,
    language: "de-CH",
    business_day_cutover_time: "00:00",
    receipt_printer: {
      enabled: false,
      provider: "none",
      device_id: null
    },
    payment_terminal: {
      enabled: false,
      provider: "none",
      device_id: null
    }
  }
};

export type CreateOrderResult = {
  order: Order;
  table: Table;
};

export type OrderSnapshotResult = {
  order: CreatedOrderSnapshot;
  table: Table;
};

export type PaymentResult = {
  payment: CompletedMockPayment;
  table: Table;
};

type OpenTableOrderSummary = {
  id: string;
  orderNumber: string;
  total: number;
};


type LocalPayment = {
  id: string;
  orderId: string;
  amount: number;
  method: string;
  status: "COMPLETED";
  createdAt: number;
};

type StoredDayClose = SavedDayClose & {
  preview: DayClosePreview;
};

function persistStaffOrders() {
  writeState("staffOrders", staffOrders);
}

function persistPosOrders() {
  writeState("posOrders", posOrders);
}

function persistPayments() {
  writeState("payments", payments);
}

function persistDayCloses() {
  writeState("dayCloses", Array.from(dayCloses.entries()));
}
type PosOrderSnapshot = {
  id: string;
  order_number: string;
  table_context: TableContext;
  lines: BasketLine[];
  subtotal: number;
  tax_total: number;
  total: number;
  status: "OPEN" | "CLOSED";
  payment_status: "UNPAID" | "PAID";
  created_at: number;
  updated_at: number;
  closed_at: number | null;
};

function createVariantItem(
  id: string,
  variantGroupId: string,
  name: string,
  priceDelta: number,
  isDefault: boolean,
  sortOrder: number
): ProductVariantGroupItem {
  return {
    id,
    variant_group_id: variantGroupId,
    name,
    price_delta: priceDelta,
    is_default: isDefault,
    sort_order: sortOrder
  };
}

export function listProducts() {
  return listCatalogProducts();
}

export function listProductVariantGroups(productId: string) {
  const product = getProductById(productId);

  if (!product || product.product_type !== "BASIC") {
    return [];
  }

  return variantGroups
    .filter((group) =>
      group.applies_to === "PRODUCT"
        ? group.product_id === product.id
        : group.category === product.category
    )
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
}

export function listTables(): Table[] {
  return layoutTables.map((table) => {
    const area = areas.find((entry) => entry.id === table.area_id);
    const openOrder = findOpenOrderForTable(table.id);

    return {
      id: table.id,
      name: table.name,
      status: openOrder ? "OPEN" : "FREE",
      areaName: area?.name ?? ""
    };
  });
}

export function getTableLayout(): TableLayout {
  return {
    tenant,
    location,
    floors: floors
      .slice()
      .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
      .map((floor) => ({
        ...floor,
        areas: areas
          .filter((area) => area.floor_id === floor.id)
          .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
          .map((area) => ({
            ...area,
            tables: layoutTables
              .filter((table) => table.area_id === area.id)
              .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
              .map(toLayoutTable)
          }))
      }))
  };
}

export function listOpenOrders() {
  return [
    ...staffOrders,
    ...posOrders.filter((order) => order.status === "OPEN" && order.payment_status === "UNPAID")
  ];
}


export function loadPosSettings(): PosSettingsFile {
  return {
    path: posSettings.path,
    settings: {
      ...posSettings.settings,
      receipt_printer: { ...posSettings.settings.receipt_printer },
      payment_terminal: { ...posSettings.settings.payment_terminal }
    }
  };
}

export function getCurrentBusinessDate(request: CurrentBusinessDateRequest): CurrentBusinessDate {
  return {
    business_date: currentBusinessDate(request.business_day_cutover_time)
  };
}

export function getDayClosePreview(request: DayClosePreviewRequest): DayClosePreview {
  const window = businessDayWindow(request.business_date, request.business_day_cutover_time);
  const completedPayments = payments.filter(
    (payment) =>
      payment.status === "COMPLETED" &&
      payment.createdAt >= window.startMs &&
      payment.createdAt < window.endMs
  );
  const paidOrderIds = new Set(completedPayments.map((payment) => payment.orderId));
  const paidOrders = posOrders.filter(
    (order) =>
      paidOrderIds.has(order.id) &&
      order.status === "CLOSED" &&
      order.payment_status === "PAID"
  );
  const expectedCash = completedPayments
    .filter((payment) => payment.method === "CASH")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const expectedCard = completedPayments
    .filter((payment) => payment.method === "CARD_MANUAL" || payment.method === "WALLEE")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const itemCount = paidOrders.reduce(
    (sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.quantity, 0),
    0
  );
  const existingClose = dayCloses.get(window.businessDate);

  return {
    business_date: window.businessDate,
    business_day_cutover_time: window.cutoverTime,
    window_start_ms: window.startMs,
    window_end_ms: window.endMs,
    expected_cash: expectedCash,
    expected_card: expectedCard,
    expected_total: expectedCash + expectedCard,
    order_count: paidOrders.length,
    item_count: itemCount,
    product_sales: buildProductSales(paidOrders),
    existing_close: existingClose
      ? {
          counted_cash: existingClose.counted_cash,
          cash_difference: existingClose.cash_difference,
          created_at: existingClose.created_at
        }
      : null
  };
}

export function saveDayClose(request: SaveDayCloseRequest): SavedDayClose {
  if (request.counted_cash < 0) {
    throw new Error("Counted cash cannot be negative.");
  }

  const preview = getDayClosePreview({
    business_date: request.business_date,
    business_day_cutover_time: request.business_day_cutover_time
  });
  const now = Date.now();
  const saved: StoredDayClose = {
    business_date: preview.business_date,
    total_cash: preview.expected_cash,
    total_card: preview.expected_card,
    counted_cash: request.counted_cash,
    cash_difference: request.counted_cash - preview.expected_cash,
    order_count: preview.order_count,
    item_count: preview.item_count,
    created_at: now,
    preview
  };

  dayCloses.set(preview.business_date, saved);
  persistDayCloses();

  return {
    business_date: saved.business_date,
    total_cash: saved.total_cash,
    total_card: saved.total_card,
    counted_cash: saved.counted_cash,
    cash_difference: saved.cash_difference,
    order_count: saved.order_count,
    item_count: saved.item_count,
    created_at: saved.created_at
  };
}
export function getOpenTableOrderBasket(tableId: string): OpenTableOrderBasket | null {
  const order = findOpenPosOrderForTable(tableId);

  if (!order) {
    return null;
  }

  return {
    order_id: order.id,
    order_number: order.order_number,
    lines: cloneBasketLines(order.lines)
  };
}

export function createOrderSnapshot(request: CreateOrderSnapshotRequest): OrderSnapshotResult {
  validateOrderSnapshotRequest(request);

  const tableContext = request.table_context;

  if (!tableContext) {
    throw new Error("Cannot create a table order snapshot without table context.");
  }

  const savedOrder = saveTableOrderSnapshot(request, Date.now());

  return {
    order: toCreatedOrderSnapshot(savedOrder.order, savedOrder.continuedExistingOrder),
    table: tableFromContext(tableContext, "OPEN")
  };
}

export function completeMockPayment(request: CompleteMockPaymentRequest): PaymentResult {
  validateMockPaymentRequest(request);

  const now = Date.now();
  const savedOrder = saveTableOrderSnapshot(request, now);
  validateMockPaymentAmounts(
    request.payment_method,
    request.received_cash,
    request.change_given,
    savedOrder.order.total
  );

  savedOrder.order.status = "CLOSED";
  savedOrder.order.payment_status = "PAID";
  savedOrder.order.updated_at = now;
  savedOrder.order.closed_at = now;

  const receivedCash = request.payment_method === "CASH" ? request.received_cash ?? null : null;
  const changeGiven = request.payment_method === "CASH" ? request.change_given ?? null : null;
  const paymentId = scopedId("pay", now, 0);
  const payment: CompletedMockPayment = {
    order_id: savedOrder.order.id,
    order_number: savedOrder.order.order_number,
    payment_id: paymentId,
    payment_method: request.payment_method,
    amount: savedOrder.order.total,
    received_cash: receivedCash,
    change_given: changeGiven,
    status: "COMPLETED",
    paid_at: now
  };

  payments.push({
    id: paymentId,
    orderId: savedOrder.order.id,
    amount: savedOrder.order.total,
    method: request.payment_method,
    status: "COMPLETED",
    createdAt: now
  });
  persistPayments();
  persistPosOrders();

  return {
    payment,
    table: tableFromContext(savedOrder.order.table_context, "FREE")
  };
}

export function createOrder(draft: OrderDraft): CreateOrderResult {
  const table = layoutTables.find((entry) => entry.id === draft.tableId);

  if (!table) {
    throw new Error("Unknown table");
  }

  const items = draft.items.map((item) => {
    const product = getProductById(item.productId);

    if (!product || !product.is_available) {
      throw new Error("Unavailable product: " + item.productId);
    }

    return {
      ...item,
      productName: product.name,
      unitPrice: product.price,
      totalPrice: product.price * item.quantity
    };
  });

  const order: Order = {
    id: randomUUID(),
    orderNumber: "L-" + String(staffOrders.length + 1).padStart(4, "0"),
    source: "STAFF",
    deviceId: draft.deviceId,
    tableId: table.id,
    tableName: table.name,
    guestCount: draft.guestCount,
    status: "OPEN",
    total: items.reduce((sum, item) => sum + item.totalPrice, 0),
    items,
    createdAt: Date.now()
  };

  staffOrders.push(order);
  persistStaffOrders();

  return {
    order,
    table: {
      id: table.id,
      name: table.name,
      status: "OPEN",
      areaName: areas.find((area) => area.id === table.area_id)?.name ?? ""
    }
  };
}

function saveTableOrderSnapshot(
  request: CreateOrderSnapshotRequest,
  now: number
): { order: PosOrderSnapshot; continuedExistingOrder: boolean } {
  const tableContext = request.table_context;

  if (!tableContext) {
    throw new Error("Cannot save a table order snapshot without table context.");
  }

  const totals = calculateOrderTotals(request.lines);
  const existingOrder = findOpenPosOrderForTable(tableContext.table_id);

  if (existingOrder) {
    existingOrder.table_context = tableContext;
    existingOrder.lines = cloneBasketLines(request.lines);
    existingOrder.subtotal = totals.subtotal;
    existingOrder.tax_total = totals.taxTotal;
    existingOrder.total = totals.total;
    existingOrder.updated_at = now;
    persistPosOrders();

    return { order: existingOrder, continuedExistingOrder: true };
  }

  const order: PosOrderSnapshot = {
    id: scopedId("ord", now, 0),
    order_number: nextOrderNumber(),
    table_context: tableContext,
    lines: cloneBasketLines(request.lines),
    subtotal: totals.subtotal,
    tax_total: totals.taxTotal,
    total: totals.total,
    status: "OPEN",
    payment_status: "UNPAID",
    created_at: now,
    updated_at: now,
    closed_at: null
  };

  posOrders.push(order);
  persistPosOrders();

  return { order, continuedExistingOrder: false };
}

function toLayoutTable(
  table: Omit<TableLayoutTable, "open_order_id" | "open_order_number" | "open_total" | "open_order_count">
): TableLayoutTable {
  const openOrder = findOpenOrderForTable(table.id);

  return {
    ...table,
    open_order_id: openOrder?.id ?? null,
    open_order_number: openOrder?.orderNumber ?? null,
    open_total: openOrder?.total ?? 0,
    open_order_count: openOrder ? 1 : 0
  };
}

function findOpenOrderForTable(tableId: string): OpenTableOrderSummary | null {
  const posOrder = findOpenPosOrderForTable(tableId);

  if (posOrder) {
    return {
      id: posOrder.id,
      orderNumber: posOrder.order_number,
      total: posOrder.total
    };
  }

  const staffOrder = staffOrders.find((order) => order.tableId === tableId && order.status === "OPEN");

  if (!staffOrder) {
    return null;
  }

  return {
    id: staffOrder.id,
    orderNumber: staffOrder.orderNumber,
    total: staffOrder.total
  };
}

function findOpenPosOrderForTable(tableId: string) {
  return posOrders.find(
    (order) =>
      order.table_context.table_id === tableId &&
      order.status === "OPEN" &&
      order.payment_status === "UNPAID"
  );
}

function tableFromContext(tableContext: TableContext, status: Table["status"]): Table {
  return {
    id: tableContext.table_id,
    name: tableContext.table_name,
    status,
    areaName: tableContext.area_name ?? ""
  };
}

function toCreatedOrderSnapshot(
  order: PosOrderSnapshot,
  continuedExistingOrder: boolean
): CreatedOrderSnapshot {
  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    payment_status: order.payment_status,
    subtotal: order.subtotal,
    tax_total: order.tax_total,
    total: order.total,
    created_at: order.created_at,
    table_id: order.table_context.table_id,
    table_name: order.table_context.table_name,
    continued_existing_order: continuedExistingOrder
  };
}

function calculateOrderTotals(lines: BasketLine[]) {
  const total = lines.reduce((sum, line) => sum + line.line_total, 0);
  const taxTotal = lines.reduce(
    (sum, line) => sum + calculateIncludedTax(line.line_total, line.tax_rate_bps),
    0
  );

  return {
    total,
    taxTotal,
    subtotal: total - taxTotal
  };
}

function calculateIncludedTax(grossAmount: number, taxRateBps: number) {
  if (taxRateBps <= 0) {
    return 0;
  }

  return Math.round((grossAmount * taxRateBps) / (10_000 + taxRateBps));
}

function validateOrderSnapshotRequest(request: CreateOrderSnapshotRequest) {
  validateOrderLines(request.lines);

  if (!request.table_context) {
    throw new Error("Cannot create a table order snapshot without table context.");
  }
}

function validateMockPaymentRequest(request: CompleteMockPaymentRequest) {
  validateOrderLines(request.lines);

  if (!request.table_context) {
    throw new Error("Cannot complete a mock payment without table context.");
  }

  if (request.payment_method !== "CASH" && request.payment_method !== "CARD_MANUAL") {
    throw new Error("Unsupported mock payment method.");
  }
}

function validateMockPaymentAmounts(
  paymentMethod: string,
  receivedCash: number | undefined,
  changeGiven: number | undefined,
  orderTotal: number
) {
  if (paymentMethod !== "CASH") {
    return;
  }

  if (receivedCash === undefined) {
    throw new Error("Cash payments require received_cash.");
  }

  if (changeGiven === undefined) {
    throw new Error("Cash payments require change_given.");
  }

  if (receivedCash < orderTotal) {
    throw new Error("Cash received cannot be lower than the order total.");
  }

  if (changeGiven !== receivedCash - orderTotal) {
    throw new Error("Cash change_given must equal received_cash minus order total.");
  }
}

function validateOrderLines(lines: BasketLine[]) {
  if (lines.length === 0) {
    throw new Error("Cannot create an order snapshot without basket lines.");
  }

  for (const line of lines) {
    if (line.quantity <= 0) {
      throw new Error("Cannot create order snapshot with invalid quantity for " + line.product_name + ".");
    }

    if (line.unit_total < 0 || line.line_total < 0) {
      throw new Error("Cannot create order snapshot with negative price for " + line.product_name + ".");
    }

    const expectedUnitTotal = line.base_price + line.variants.reduce((sum, variant) => sum + variant.price_delta, 0);

    if (expectedUnitTotal !== line.unit_total) {
      throw new Error("Cannot create order snapshot because " + line.product_name + " has an inconsistent unit price.");
    }

    const expectedLineTotal = line.unit_total * line.quantity;

    if (expectedLineTotal !== line.line_total) {
      throw new Error("Cannot create order snapshot because " + line.product_name + " has an inconsistent total.");
    }
  }
}


function buildProductSales(orders: PosOrderSnapshot[]): DayCloseProductSale[] {
  const salesByProduct = new Map<string, DayCloseProductSale>();

  for (const order of orders) {
    for (const line of order.lines) {
      const key = line.product_id + ":" + line.product_name;
      const existing = salesByProduct.get(key);

      if (existing) {
        existing.quantity += line.quantity;
        existing.total += line.line_total;
      } else {
        salesByProduct.set(key, {
          product_id: line.product_id,
          product_name: line.product_name,
          product_category: line.product_category,
          quantity: line.quantity,
          total: line.line_total
        });
      }
    }
  }

  return Array.from(salesByProduct.values()).sort(
    (left, right) => right.total - left.total || left.product_name.localeCompare(right.product_name)
  );
}

function currentBusinessDate(cutoverTime: string) {
  const cutoverMinutes = parseCutoverMinutes(cutoverTime);
  const now = new Date();
  const minutesAfterMidnight = now.getHours() * 60 + now.getMinutes();
  const businessDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (minutesAfterMidnight < cutoverMinutes) {
    businessDate.setDate(businessDate.getDate() - 1);
  }

  return formatLocalDate(businessDate);
}

function businessDayWindow(businessDate: string, cutoverTime: string) {
  const cutoverMinutes = parseCutoverMinutes(cutoverTime);
  const startDate = parseBusinessDate(businessDate);
  startDate.setHours(Math.floor(cutoverMinutes / 60), cutoverMinutes % 60, 0, 0);

  const endDate = new Date(startDate.getTime());
  endDate.setDate(endDate.getDate() + 1);

  return {
    businessDate,
    cutoverTime,
    startMs: startDate.getTime(),
    endMs: endDate.getTime()
  };
}

function parseBusinessDate(businessDate: string) {
  const parts = businessDate.split("-").map((part) => Number(part));

  if (
    parts.length !== 3 ||
    !Number.isInteger(parts[0]) ||
    !Number.isInteger(parts[1]) ||
    !Number.isInteger(parts[2])
  ) {
    throw new Error("Business date must use YYYY-MM-DD.");
  }

  const [year, month, day] = parts as [number, number, number];
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error("Business date must use YYYY-MM-DD.");
  }

  return parsed;
}

function parseCutoverMinutes(cutoverTime: string) {
  const [hoursText, minutesText] = cutoverTime.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error("Business day cutover time must use HH:mm.");
  }

  return hours * 60 + minutes;
}

function formatLocalDate(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
function nextOrderNumber() {
  const orderNumber = "R" + String(nextPosOrderNumber).padStart(5, "0");
  nextPosOrderNumber += 1;
  return orderNumber;
}

function scopedId(prefix: string, timestamp: number, index: number) {
  return prefix + "_" + timestamp + "_" + index;
}

function cloneBasketLines(lines: BasketLine[]) {
  return lines.map((line) => ({
    ...line,
    variants: line.variants.map((variant) => ({ ...variant }))
  }));
}















