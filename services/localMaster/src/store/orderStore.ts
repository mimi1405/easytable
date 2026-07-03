import { randomUUID } from "node:crypto";

import { getProductById } from "../catalogStore.js";
import { rebuildKdsTicketsForOrder } from "./kdsStore.js";
import { rebuildStationPrintJobsForOrder, enqueueReceiptPrintJob } from "./printStore.js";
import { areas, layoutTables } from "./storeSeeds.js";
import {
  payments,
  persistPayments,
  persistPosOrders,
  persistStaffOrders,
  posOrders,
  staffOrders
} from "./storeState.js";
import type { PosOrderSnapshot } from "./storeState.js";
import {
  cloneBasketLines,
  scopedId
} from "./storeHelpers.js";
import { findOpenPosOrderForTable, tableFromContext } from "./tableStore.js";
import type {
  BasketLine,
  CompleteMockPaymentRequest,
  CompletedMockPayment,
  CreatedOrderSnapshot,
  CreateOrderSnapshotRequest,
  KdsTicket,
  OpenTableOrderBasket,
  Order,
  OrderDraft,
  PrintJob,
  Table
} from "../types.js";

let nextPosOrderNumber = 1;

export type CreateOrderResult = {
  order: Order;
  table: Table;
};

export type OrderSnapshotResult = {
  order: CreatedOrderSnapshot;
  table: Table;
  kdsTicketsCreated: KdsTicket[];
  kdsTicketsUpdated: KdsTicket[];
  printJobsCreated: PrintJob[];
  printJobsUpdated: PrintJob[];
};

export type PaymentResult = {
  payment: CompletedMockPayment;
  table: Table | null;
};

export function listOpenOrders() {
  return [
    ...staffOrders,
    ...posOrders.filter((order) => order.status === "OPEN" && order.payment_status === "UNPAID")
  ];
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
  const outputChanges = routeOrderOutputsForOrder(savedOrder.order);

  return {
    order: toCreatedOrderSnapshot(savedOrder.order, savedOrder.continuedExistingOrder),
    table: tableFromContext(tableContext, "OPEN"),
    kdsTicketsCreated: outputChanges.kdsTicketsCreated,
    kdsTicketsUpdated: outputChanges.kdsTicketsUpdated,
    printJobsCreated: outputChanges.printJobsCreated,
    printJobsUpdated: outputChanges.printJobsUpdated
  };
}

export function completeMockPayment(request: CompleteMockPaymentRequest): PaymentResult {
  validateMockPaymentRequest(request);

  const now = Date.now();
  const requestTotal = calculateOrderTotals(request.lines).total;
  validateMockPaymentAmounts(
    request.payment_method,
    request.received_cash,
    request.change_given,
    requestTotal
  );
  const savedOrder = request.table_context ? saveTableOrderSnapshot(request, now) : saveCounterPaymentOrder(request, now);

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
  enqueueReceiptPrintJob(request.terminal_id, savedOrder.order, payment);

  return {
    payment,
    table: savedOrder.order.table_context ? tableFromContext(savedOrder.order.table_context, "FREE") : null
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

function saveCounterPaymentOrder(
  request: CompleteMockPaymentRequest,
  now: number
): { order: PosOrderSnapshot; continuedExistingOrder: boolean } {
  const totals = calculateOrderTotals(request.lines);
  const order: PosOrderSnapshot = {
    id: scopedId("ord", now, 0),
    order_number: nextOrderNumber(),
    table_context: null,
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

function routeOrderOutputsForOrder(order: PosOrderSnapshot) {
  const kdsTicketChanges = rebuildKdsTicketsForOrder(order);
  const printJobChanges = rebuildStationPrintJobsForOrder(order);

  return {
    kdsTicketsCreated: kdsTicketChanges.created,
    kdsTicketsUpdated: kdsTicketChanges.updated,
    printJobsCreated: printJobChanges.created,
    printJobsUpdated: printJobChanges.updated
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
    table_id: order.table_context?.table_id ?? null,
    table_name: order.table_context?.table_name ?? null,
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

function nextOrderNumber() {
  const orderNumber = "R" + String(nextPosOrderNumber).padStart(5, "0");
  nextPosOrderNumber += 1;
  return orderNumber;
}
