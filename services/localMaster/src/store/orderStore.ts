import { randomUUID } from "node:crypto";

import { getProductById } from "../catalogStore.js";
import {
  appendOutboxEvent,
  beginIdempotentCommand,
  completeIdempotentCommand,
  failIdempotentCommand
} from "./commandStore.js";
import { rebuildKdsTicketsForOrder } from "./kdsStore.js";
import { rebuildStationPrintJobsForOrder, enqueueReceiptPrintJob } from "./printStore.js";
import { areas, layoutTables } from "./storeSeeds.js";
import { startWalleeLtiPayment } from "./walleeLtiProvider.js";
import {
  payments,
  persistPayments,
  persistPosOrders,
  persistStaffOrders,
  posOrders,
  staffOrders
} from "./storeState.js";
import type { LocalPayment, PaymentLifecycleState, PosOrderSnapshot } from "./storeState.js";
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
  StartWalleeTerminalPaymentRequest,
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
  replayed?: boolean;
};

export type PaymentResult = {
  payment: CompletedMockPayment;
  table: Table | null;
  replayed?: boolean;
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

  const requestId = request.request_id?.trim();

  if (requestId) {
    const command = beginIdempotentCommand("ORDER_SNAPSHOT", requestId, {
      lines: request.lines,
      table_context: request.table_context
    });

    if (command.mode === "replay") {
      return { ...(command.result as OrderSnapshotResult), replayed: true };
    }

    try {
      const result = createOrderSnapshotUnchecked(request);
      appendOutboxEvent("ORDER_RECORDED", result.order.id, result.order);
      return completeIdempotentCommand(command.entry, result);
    } catch (error) {
      return failIdempotentCommand(command.entry, error);
    }
  }

  return createOrderSnapshotUnchecked(request);
}

function createOrderSnapshotUnchecked(request: CreateOrderSnapshotRequest): OrderSnapshotResult {
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

  const requestId = request.request_id.trim();
  const existingPayment = payments.find((payment) => payment.requestId === requestId);

  if (existingPayment) {
    return {
      payment: toCompletedMockPayment(existingPayment),
      table: tableForPayment(existingPayment),
      replayed: true
    };
  }

  const command = beginIdempotentCommand("PAYMENT_LOCAL_COMPLETE", requestId, {
    lines: request.lines,
    table_context: request.table_context,
    payment_method: request.payment_method,
    received_cash: request.received_cash ?? null,
    change_given: request.change_given ?? null,
    terminal_id: request.terminal_id ?? null
  });

  if (command.mode === "replay") {
    return { ...(command.result as PaymentResult), replayed: true };
  }

  try {
    const result = completeMockPaymentUnchecked(request, requestId);
    if (result.payment.lifecycle_state === "completed") {
      appendOutboxEvent("PAYMENT_COMPLETED", result.payment.payment_id, result.payment);
    }
    return completeIdempotentCommand(command.entry, result);
  } catch (error) {
    return failIdempotentCommand(command.entry, error);
  }
}

function completeMockPaymentUnchecked(request: CompleteMockPaymentRequest, requestId: string): PaymentResult {
  const existingPayment = payments.find((payment) => payment.requestId === requestId);

  if (existingPayment) {
    return {
      payment: toCompletedMockPayment(existingPayment),
      table: tableForPayment(existingPayment),
      replayed: true
    };
  }

  const now = Date.now();
  const requestTotal = calculateOrderTotals(request.lines).total;
  validateMockPaymentAmounts(
    request.payment_method,
    request.received_cash,
    request.change_given,
    requestTotal
  );
  const savedOrder = request.table_context ? saveTableOrderSnapshot(request, now) : saveCounterPaymentOrder(request, now);
  const receivedCash = request.payment_method === "CASH" ? request.received_cash ?? null : null;
  const changeGiven = request.payment_method === "CASH" ? request.change_given ?? null : null;
  const terminalId = request.terminal_id?.trim() || null;
  const paymentId = scopedId("pay", now, 0);
  const paymentRecord: LocalPayment = {
    id: paymentId,
    requestId,
    orderId: savedOrder.order.id,
    orderNumber: savedOrder.order.order_number,
    terminalId,
    amount: savedOrder.order.total,
    receivedCash,
    changeGiven,
    method: request.payment_method,
    status: "PENDING",
    provider: "LOCAL",
    providerTransactionId: null,
    providerStatus: "AUTHORIZED",
    lifecycleState: "payment_started",
    receiptPrintJobId: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };

  payments.push(paymentRecord);
  persistPayments();
  advancePaymentLifecycle(paymentRecord, "provider_authorized");

  savedOrder.order.status = "CLOSED";
  savedOrder.order.payment_status = "PAID";
  savedOrder.order.updated_at = now;
  savedOrder.order.closed_at = now;
  persistPosOrders();
  advancePaymentLifecycle(paymentRecord, "local_recorded");

  try {
    const receiptJob = enqueueReceiptPrintJob(terminalId ?? undefined, savedOrder.order, toCompletedMockPayment(paymentRecord));

    paymentRecord.receiptPrintJobId = receiptJob?.id ?? null;
    advancePaymentLifecycle(paymentRecord, receiptJob ? "receipt_queued" : "completed");
    if (receiptJob) {
      advancePaymentLifecycle(paymentRecord, "completed");
    }
  } catch (error) {
    paymentRecord.status = "FAILED";
    paymentRecord.failureReason = error instanceof Error ? error.message : String(error);
    advancePaymentLifecycle(paymentRecord, "reversal_required");
  }

  return {
    payment: toCompletedMockPayment(paymentRecord),
    table: savedOrder.order.table_context ? tableFromContext(savedOrder.order.table_context, "FREE") : null
  };
}

export function startWalleeTerminalPayment(request: StartWalleeTerminalPaymentRequest): PaymentResult {
  validateWalleeTerminalPaymentRequest(request);

  const requestId = request.request_id.trim();
  const existingPayment = payments.find((payment) => payment.requestId === requestId);

  if (existingPayment) {
    return {
      payment: toCompletedMockPayment(existingPayment),
      table: tableForPayment(existingPayment),
      replayed: true
    };
  }

  const command = beginIdempotentCommand("PAYMENT_WALLEE_TERMINAL_START", requestId, {
    lines: request.lines,
    table_context: request.table_context,
    terminal_id: request.terminal_id ?? null,
    simulator_outcome: request.simulator_outcome ?? null
  });

  if (command.mode === "replay") {
    return { ...(command.result as PaymentResult), replayed: true };
  }

  try {
    const result = startWalleeTerminalPaymentUnchecked(request, requestId);
    if (result.payment.lifecycle_state === "completed") {
      appendOutboxEvent("PAYMENT_COMPLETED", result.payment.payment_id, result.payment);
    }
    return completeIdempotentCommand(command.entry, result);
  } catch (error) {
    return failIdempotentCommand(command.entry, error);
  }
}

function startWalleeTerminalPaymentUnchecked(
  request: StartWalleeTerminalPaymentRequest,
  requestId: string
): PaymentResult {
  const existingPayment = payments.find((payment) => payment.requestId === requestId);

  if (existingPayment) {
    return {
      payment: toCompletedMockPayment(existingPayment),
      table: tableForPayment(existingPayment),
      replayed: true
    };
  }

  const now = Date.now();
  const totals = calculateOrderTotals(request.lines);
  const terminalId = request.terminal_id?.trim() || null;
  const providerResult = startWalleeLtiPayment({
    request_id: requestId,
    amount: totals.total,
    terminal_id: terminalId,
    lines: request.lines,
    table_context: request.table_context,
    simulator_outcome: request.simulator_outcome
  });

  if (!providerResult.authorized) {
    const failedPayment = createProviderOnlyPaymentRecord({
      requestId,
      now,
      terminalId,
      amount: totals.total,
      provider: providerResult.provider,
      providerTransactionId: providerResult.provider_transaction_id,
      providerStatus: providerResult.provider_status,
      failureReason: providerResult.failure_reason
    });

    return {
      payment: toCompletedMockPayment(failedPayment),
      table: null
    };
  }

  const savedOrder = request.table_context ? saveTableOrderSnapshot(request, now) : saveCounterPaymentOrder(request, now);
  const paymentRecord: LocalPayment = {
    id: scopedId("pay", now, 0),
    requestId,
    orderId: savedOrder.order.id,
    orderNumber: savedOrder.order.order_number,
    terminalId,
    amount: savedOrder.order.total,
    receivedCash: null,
    changeGiven: null,
    method: "WALLEE_TERMINAL",
    status: "PENDING",
    provider: providerResult.provider,
    providerTransactionId: providerResult.provider_transaction_id,
    providerStatus: providerResult.provider_status,
    lifecycleState: "provider_authorized",
    receiptPrintJobId: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };

  payments.push(paymentRecord);
  persistPayments();

  savedOrder.order.status = "CLOSED";
  savedOrder.order.payment_status = "PAID";
  savedOrder.order.updated_at = now;
  savedOrder.order.closed_at = now;
  persistPosOrders();
  advancePaymentLifecycle(paymentRecord, "local_recorded");

  try {
    const receiptJob = enqueueReceiptPrintJob(terminalId ?? undefined, savedOrder.order, toCompletedMockPayment(paymentRecord));

    paymentRecord.receiptPrintJobId = receiptJob?.id ?? null;
    advancePaymentLifecycle(paymentRecord, receiptJob ? "receipt_queued" : "completed");
    if (receiptJob) {
      advancePaymentLifecycle(paymentRecord, "completed");
    }
  } catch (error) {
    paymentRecord.status = "FAILED";
    paymentRecord.failureReason = error instanceof Error ? error.message : String(error);
    advancePaymentLifecycle(paymentRecord, "reversal_required");
  }

  return {
    payment: toCompletedMockPayment(paymentRecord),
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
  request: CreateOrderSnapshotRequest,
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

function toCompletedMockPayment(payment: LocalPayment): CompletedMockPayment {
  const order = posOrders.find((entry) => entry.id === payment.orderId);

  return {
    order_id: payment.orderId,
    order_number: payment.orderNumber ?? order?.order_number ?? payment.orderId,
    payment_id: payment.id,
    request_id: payment.requestId ?? payment.id,
    payment_method: payment.method,
    amount: payment.amount,
    received_cash: payment.receivedCash ?? null,
    change_given: payment.changeGiven ?? null,
    status: payment.status,
    paid_at: payment.completedAt ?? payment.createdAt,
    terminal_id: payment.terminalId ?? null,
    provider: payment.provider ?? "LOCAL",
    provider_transaction_id: payment.providerTransactionId ?? null,
    provider_status: payment.providerStatus ?? (payment.status === "COMPLETED" ? "AUTHORIZED" : "UNKNOWN"),
    lifecycle_state: payment.lifecycleState ?? (payment.status === "COMPLETED" ? "completed" : "failed"),
    receipt_print_job_id: payment.receiptPrintJobId ?? null,
    failure_reason: payment.failureReason ?? null,
    created_at: payment.createdAt,
    updated_at: payment.updatedAt ?? payment.createdAt,
    completed_at: payment.completedAt ?? (payment.status === "COMPLETED" ? payment.createdAt : null)
  };
}

function advancePaymentLifecycle(payment: LocalPayment, lifecycleState: PaymentLifecycleState) {
  const now = Date.now();

  payment.lifecycleState = lifecycleState;
  payment.updatedAt = now;
  if (lifecycleState === "completed") {
    payment.status = "COMPLETED";
    payment.completedAt = now;
  }
  persistPayments();
}

function tableForPayment(payment: LocalPayment) {
  const order = posOrders.find((entry) => entry.id === payment.orderId);

  if (!order?.table_context || order.status !== "CLOSED" || order.payment_status !== "PAID") {
    return null;
  }

  return tableFromContext(order.table_context, "FREE");
}

function createProviderOnlyPaymentRecord(request: {
  requestId: string;
  now: number;
  terminalId: string | null;
  amount: number;
  provider: string;
  providerTransactionId: string | null;
  providerStatus: string;
  failureReason: string | null;
}) {
  const payment: LocalPayment = {
    id: scopedId("pay", request.now, 0),
    requestId: request.requestId,
    orderId: "provider_only_" + request.requestId,
    orderNumber: "Provider only",
    terminalId: request.terminalId,
    amount: request.amount,
    receivedCash: null,
    changeGiven: null,
    method: "WALLEE_TERMINAL",
    status: "FAILED",
    provider: request.provider,
    providerTransactionId: request.providerTransactionId,
    providerStatus: request.providerStatus,
    lifecycleState: "failed",
    receiptPrintJobId: null,
    failureReason: request.failureReason,
    createdAt: request.now,
    updatedAt: request.now,
    completedAt: null
  };

  payments.push(payment);
  persistPayments();

  return payment;
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

  if (!request.request_id?.trim()) {
    throw new Error("Payment request_id is required.");
  }

  if (request.payment_method !== "CASH" && request.payment_method !== "CARD_MANUAL") {
    throw new Error("Unsupported mock payment method.");
  }
}

function validateWalleeTerminalPaymentRequest(request: StartWalleeTerminalPaymentRequest) {
  validateOrderLines(request.lines);

  if (!request.request_id?.trim()) {
    throw new Error("Payment request_id is required.");
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
