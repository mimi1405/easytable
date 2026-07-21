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
import { startWalleeCloudTillPayment } from "./walleeCloudTillProvider.js";
import { completePaymentRecoveryJobsForAttempt, ensurePaymentRecoveryJob, getPaymentAttempt, updatePaymentAttempt } from "./paymentAttemptStore.js";
import type { PaymentProviderResult } from "./paymentProviderTypes.js";
import { recordCompletedSaleSnapshot, recordComplimentarySaleSnapshot } from "./reportingStore.js";
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
import { findOpenPosOrderForTable, findOpenStaffOrderForTable, getTableLayout, tableFromContext } from "./tableStore.js";
import type {
  AdjustComplimentaryQuantityRequest,
  BasketLine,
  CompleteCashPaymentRequest,
  CompleteComplimentaryOrderRequest,
  ComplimentaryOrderResult,
  PaymentResult as CompletedPaymentResult,
  CreatedOrderSnapshot,
  CreateOrderSnapshotRequest,
  KdsTicket,
  OpenTableOrderBasket,
  Order,
  OrderDraft,
  OrderItem,
  PrintJob,
  StartWalleeTerminalPaymentRequest,
  Table,
  TableContext
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
  payment: CompletedPaymentResult;
  table: Table | null;
  replayed?: boolean;
};

export type ComplimentaryOrderCommandResult = {
  result: ComplimentaryOrderResult;
  table: Table | null;
  replayed?: boolean;
};

export function listOpenOrders() {
  return [
    ...staffOrders.filter((order) => order.status === "OPEN"),
    ...posOrders.filter((order) => order.status === "OPEN" && order.payment_status === "UNPAID")
  ];
}

export function getOpenTableOrderBasket(tableId: string): OpenTableOrderBasket | null {
  if (!isKnownLayoutTable(tableId)) {
    return null;
  }

  const order = findOpenPosOrderForTable(tableId);

  if (order) {
    return {
      order_id: order.id,
      order_number: order.order_number,
      lines: cloneBasketLines(order.lines)
    };
  }

  const staffOrder = findOpenStaffOrderForTable(tableId);

  if (!staffOrder) {
    return null;
  }

  return {
    order_id: staffOrder.id,
    order_number: staffOrder.orderNumber,
    lines: staffOrder.items.map(staffOrderItemToBasketLine)
  };
}

export function adjustComplimentaryQuantity(request: AdjustComplimentaryQuantityRequest): OpenTableOrderBasket & { replayed?: boolean } {
  const command = beginIdempotentCommand("ORDER_COMPLIMENTARY_ADJUST", request.request_id, {
    order_id: request.order_id,
    line_id: request.line_id,
    complimentary_quantity: request.complimentary_quantity,
    actor: request.actor
  });
  if (command.mode === "replay") return { ...(command.result as OpenTableOrderBasket), replayed: true };

  try {
    const order = posOrders.find((candidate) => candidate.id === request.order_id && candidate.status === "OPEN");
    if (!order) throw new Error("Open order not found.");
    const line = order.lines.find((candidate) => candidate.id === request.line_id);
    if (!line) throw new Error("Order line not found.");
    if (!Number.isInteger(request.complimentary_quantity) || request.complimentary_quantity < 0 || request.complimentary_quantity > line.quantity) {
      throw new Error("Complimentary quantity must be between zero and line quantity.");
    }

    line.complimentary_quantity = request.complimentary_quantity;
    line.complimentary_value = request.complimentary_quantity * line.unit_total;
    line.line_total = (line.quantity - request.complimentary_quantity) * line.unit_total;
    const totals = calculateOrderTotals(order.lines);
    order.subtotal = totals.subtotal;
    order.tax_total = totals.taxTotal;
    order.total = totals.total;
    order.actor = order.lines.some((candidate) => candidate.complimentary_quantity > 0) ? request.actor : null;
    order.updated_at = Date.now();
    persistPosOrders();

    const result: OpenTableOrderBasket = {
      order_id: order.id,
      order_number: order.order_number,
      lines: cloneBasketLines(order.lines)
    };
    return completeIdempotentCommand(command.entry, result);
  } catch (error) {
    return failIdempotentCommand(command.entry, error);
  }
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

export function completeCashPayment(request: CompleteCashPaymentRequest): PaymentResult {
  validateCashPaymentRequest(request);

  const requestId = request.request_id.trim();
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
    const result = completeCashPaymentUnchecked(request, requestId);
    if (result.payment.lifecycle_state === "completed") {
      appendOutboxEvent("PAYMENT_COMPLETED", result.payment.payment_id, result.payment);
    }
    return completeIdempotentCommand(command.entry, result);
  } catch (error) {
    return failIdempotentCommand(command.entry, error);
  }
}

export function completeComplimentaryOrder(request: CompleteComplimentaryOrderRequest): ComplimentaryOrderCommandResult {
  validateOrderLines(request.lines);
  if (!request.request_id?.trim()) throw new Error("Complimentary order request_id is required.");
  if (request.lines.some((line) => line.complimentary_quantity !== line.quantity || line.line_total !== 0)) {
    throw new Error("Complimentary completion requires every basket unit to be complimentary.");
  }

  const command = beginIdempotentCommand("ORDER_COMPLIMENTARY_COMPLETE", request.request_id, {
    lines: request.lines,
    table_context: request.table_context,
    terminal_id: request.terminal_id ?? null,
    actor: request.actor ?? null
  });
  if (command.mode === "replay") return { ...(command.result as ComplimentaryOrderCommandResult), replayed: true };

  try {
    const now = Date.now();
    const savedOrder = request.table_context ? saveTablePaymentOrderSnapshot(request, now) : saveCounterPaymentOrder(request, now);
    savedOrder.order.status = "CLOSED";
    savedOrder.order.payment_status = "COMPLIMENTARY";
    savedOrder.order.updated_at = now;
    savedOrder.order.closed_at = now;
    persistPosOrders();

    if (!savedOrder.continuedExistingOrder) {
      routeOrderOutputsForOrder(savedOrder.order);
    }
    const terminalId = request.terminal_id?.trim() || null;
    const settlement = complimentarySettlementResult(savedOrder.order, request.request_id, terminalId, now);
    enqueueReceiptPrintJob(terminalId ?? undefined, savedOrder.order, settlement);
    recordComplimentarySaleSnapshot(savedOrder.order, request.request_id, terminalId);
    const result: ComplimentaryOrderCommandResult = {
      result: {
        order_id: savedOrder.order.id,
        order_number: savedOrder.order.order_number,
        status: "COMPLETED",
        total: 0,
        complimentary_value: request.lines.reduce((sum, line) => sum + line.complimentary_value, 0),
        terminal_id: terminalId,
        completed_at: now
      },
      table: savedOrder.order.table_context ? tableFromContext(savedOrder.order.table_context, "FREE") : null
    };
    return completeIdempotentCommand(command.entry, result);
  } catch (error) {
    return failIdempotentCommand(command.entry, error);
  }
}

function completeCashPaymentUnchecked(request: CompleteCashPaymentRequest, requestId: string): PaymentResult {
  const existingPayment = payments.find((payment) => payment.requestId === requestId);

  if (existingPayment) {
    return {
      payment: toPaymentResult(existingPayment),
      table: tableForPayment(existingPayment),
      replayed: true
    };
  }

  const now = Date.now();
  const requestTotal = calculateOrderTotals(request.lines).total;
  validateCashPaymentAmounts(
    request.payment_method,
    request.received_cash,
    request.change_given,
    requestTotal
  );
  const savedOrder = request.table_context ? saveTablePaymentOrderSnapshot(request, now) : saveCounterPaymentOrder(request, now);
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
    const receiptJob = enqueueReceiptPrintJob(terminalId ?? undefined, savedOrder.order, toPaymentResult(paymentRecord));

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

  if (paymentRecord.lifecycleState === "completed") {
    recordCompletedSaleSnapshot(savedOrder.order, paymentRecord, toPaymentResult(paymentRecord));
  }

  return {
    payment: toPaymentResult(paymentRecord),
    table: savedOrder.order.table_context ? tableFromContext(savedOrder.order.table_context, "FREE") : null
  };
}

function finalizeAuthorizedWalleePayment(
  request: StartWalleeTerminalPaymentRequest,
  requestId: string,
  providerResult: PaymentProviderResult,
  now = Date.now()
): PaymentResult {
  const terminalId = request.wallee_terminal_config_id?.trim() || null;
  const savedOrder = request.table_context ? saveTablePaymentOrderSnapshot(request, now) : saveCounterPaymentOrder(request, now);
  const paymentRecord: LocalPayment = {
    id: scopedId("pay", now, 0),
    paymentAttemptId: providerResult.payment_attempt_id,
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
    lifecycleState: providerResult.lifecycle_state,
    receiptPrintJobId: null,
    failureReason: null,
    reconciliationRequired: false,
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
    const receiptJob = enqueueReceiptPrintJob(request.pos_terminal_id?.trim() || undefined, savedOrder.order, toPaymentResult(paymentRecord));
    paymentRecord.receiptPrintJobId = receiptJob?.id ?? null;
    advancePaymentLifecycle(paymentRecord, receiptJob ? "receipt_queued" : "completed");
    if (receiptJob) advancePaymentLifecycle(paymentRecord, "completed");
  } catch (error) {
    paymentRecord.status = "FAILED";
    paymentRecord.failureReason = error instanceof Error ? error.message : String(error);
    advancePaymentLifecycle(paymentRecord, "reversal_required");
    if (paymentRecord.paymentAttemptId) {
      updatePaymentAttempt(paymentRecord.paymentAttemptId, {
        lifecycleState: "reversal_required",
        reconciliationRequired: true,
        failureReason: paymentRecord.failureReason
      });
      ensurePaymentRecoveryJob(paymentRecord.paymentAttemptId, "VOID");
    }
  }

  if (paymentRecord.lifecycleState === "completed") {
    recordCompletedSaleSnapshot(savedOrder.order, paymentRecord, toPaymentResult(paymentRecord));
    if (paymentRecord.paymentAttemptId) {
      updatePaymentAttempt(paymentRecord.paymentAttemptId, {
        orderId: savedOrder.order.id,
        paymentId: paymentRecord.id,
        lifecycleState: "completed",
        reconciliationRequired: false,
        completedAt: paymentRecord.completedAt ?? Date.now()
      });
      completePaymentRecoveryJobsForAttempt(paymentRecord.paymentAttemptId, "RECONCILE");
    }
  }

  return {
    payment: toPaymentResult(paymentRecord),
    table: savedOrder.order.table_context ? tableFromContext(savedOrder.order.table_context, "FREE") : null
  };
}

export function finalizeRecoveredWalleePaymentAttempt(paymentAttemptId: string): PaymentResult {
  const attempt = getPaymentAttempt(paymentAttemptId);
  if (!attempt) throw new Error("Payment attempt not found.");
  const existing = payments.find((payment) => payment.paymentAttemptId === paymentAttemptId || payment.id === attempt.paymentId);
  if (existing) return { payment: toPaymentResult(existing), table: tableForPayment(existing), replayed: true };
  if (attempt.lifecycleState !== "provider_authorized" && attempt.lifecycleState !== "provider_completed") {
    throw new Error("Payment attempt is not provider-authorized.");
  }
  const request = JSON.parse(attempt.requestJson) as StartWalleeTerminalPaymentRequest;
  const result = finalizeAuthorizedWalleePayment(request, attempt.requestId, {
    provider: "WALLEE_CLOUD_TILL",
    payment_attempt_id: attempt.id,
    provider_transaction_id: attempt.providerTransactionId,
    provider_status: attempt.providerState ?? "UNKNOWN",
    lifecycle_state: attempt.lifecycleState as PaymentProviderResult["lifecycle_state"],
    authorized: true,
    reconciliation_required: false,
    failure_reason: null
  });
  if (result.payment.lifecycle_state === "completed") {
    appendOutboxEvent("PAYMENT_COMPLETED", result.payment.payment_id, result.payment);
  }
  return result;
}

export async function startWalleeTerminalPayment(request: StartWalleeTerminalPaymentRequest): Promise<PaymentResult> {
  validateWalleeTerminalPaymentRequest(request);

  const requestId = request.request_id.trim();
  const command = beginIdempotentCommand("PAYMENT_WALLEE_TERMINAL_START", requestId, {
    lines: request.lines,
    table_context: request.table_context,
    wallee_terminal_config_id: request.wallee_terminal_config_id ?? null,
    pos_terminal_id: request.pos_terminal_id ?? null
  });

  if (command.mode === "replay") {
    return { ...(command.result as PaymentResult), replayed: true };
  }

  try {
    const result = await startWalleeTerminalPaymentUnchecked(request, requestId);
    if (result.payment.lifecycle_state === "completed") {
      appendOutboxEvent("PAYMENT_COMPLETED", result.payment.payment_id, result.payment);
    }
    return completeIdempotentCommand(command.entry, result);
  } catch (error) {
    return failIdempotentCommand(command.entry, error);
  }
}

async function startWalleeTerminalPaymentUnchecked(
  request: StartWalleeTerminalPaymentRequest,
  requestId: string
): Promise<PaymentResult> {
  const existingPayment = payments.find((payment) => payment.requestId === requestId);

  if (existingPayment) {
    return {
      payment: toPaymentResult(existingPayment),
      table: tableForPayment(existingPayment),
      replayed: true
    };
  }

  const now = Date.now();
  const totals = calculateOrderTotals(request.lines);
  const terminalId = request.wallee_terminal_config_id?.trim() || null;
  const providerResult = await startWalleeCloudTillPayment({
    request_id: requestId,
    amount: totals.total,
    lines: request.lines,
    table_context: request.table_context,
    request
  });

  if (!providerResult.authorized) {
    const failedPayment = createProviderOnlyPaymentRecord({
      requestId,
      now,
      paymentAttemptId: providerResult.payment_attempt_id,
      terminalId,
      amount: totals.total,
      provider: providerResult.provider,
      providerTransactionId: providerResult.provider_transaction_id,
      providerStatus: providerResult.provider_status,
      lifecycleState: providerResult.lifecycle_state,
      reconciliationRequired: providerResult.reconciliation_required,
      failureReason: providerResult.failure_reason
    });

    return {
      payment: toPaymentResult(failedPayment),
      table: null
    };
  }

  return finalizeAuthorizedWalleePayment(request, requestId, providerResult, now);
}

export function createOrder(draft: OrderDraft): CreateOrderResult {
  const layoutEntry = findLayoutTable(draft.tableId);
  const table = layoutEntry?.table;

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
    locationId: layoutEntry.floor.location_id,
    guestCount: draft.guestCount,
    status: "OPEN",
    total: items.reduce((sum, item) => sum + item.totalPrice, 0),
    items,
    createdAt: Date.now(),
    closedAt: null
  };

  staffOrders.push(order);
  persistStaffOrders();

  return {
    order,
    table: {
      id: table.id,
      name: table.name,
      status: "OPEN",
      areaName: layoutEntry.area.name
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
  const existingOrder = findOpenPosOrderForTable(tableContext.table_id, tableContext.location_id);

  if (existingOrder) {
    existingOrder.table_context = tableContext;
    existingOrder.lines = cloneBasketLines(request.lines);
    existingOrder.subtotal = totals.subtotal;
    existingOrder.tax_total = totals.taxTotal;
    existingOrder.total = totals.total;
    existingOrder.actor = request.actor ?? existingOrder.actor ?? null;
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
    actor: request.actor ?? null,
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

function saveTablePaymentOrderSnapshot(
  request: CreateOrderSnapshotRequest,
  now: number
): { order: PosOrderSnapshot; continuedExistingOrder: boolean } {
  const tableContext = request.table_context;

  if (!tableContext) {
    throw new Error("Cannot save a table payment without table context.");
  }

  const existingPosOrder = findOpenPosOrderForTable(tableContext.table_id, tableContext.location_id);

  if (existingPosOrder) {
    return saveTableOrderSnapshot(request, now);
  }

  const staffOrder = findOpenStaffOrderForTable(tableContext.table_id, tableContext.location_id);

  if (!staffOrder) {
    return saveTableOrderSnapshot(request, now);
  }

  const totals = calculateOrderTotals(request.lines);
  const order: PosOrderSnapshot = {
    id: staffOrder.id,
    order_number: staffOrder.orderNumber,
    table_context: tableContext,
    lines: cloneBasketLines(request.lines),
    subtotal: totals.subtotal,
    tax_total: totals.taxTotal,
    total: totals.total,
    actor: request.actor ?? null,
    status: "CLOSED",
    payment_status: "PAID",
    created_at: staffOrder.createdAt,
    updated_at: now,
    closed_at: now
  };

  posOrders.push(order);
  staffOrder.status = "CLOSED";
  staffOrder.closedAt = now;
  persistPosOrders();
  persistStaffOrders();

  return { order, continuedExistingOrder: true };
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
    actor: request.actor ?? null,
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

function toPaymentResult(payment: LocalPayment): CompletedPaymentResult {
  const order = posOrders.find((entry) => entry.id === payment.orderId);

  return {
    order_id: payment.orderId,
    order_number: payment.orderNumber ?? order?.order_number ?? payment.orderId,
    payment_id: payment.id,
    payment_attempt_id: payment.paymentAttemptId ?? null,
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
    reconciliation_required: payment.reconciliationRequired ?? payment.lifecycleState === "reconciliation_required",
    receipt_print_job_id: payment.receiptPrintJobId ?? null,
    failure_reason: payment.failureReason ?? null,
    created_at: payment.createdAt,
    updated_at: payment.updatedAt ?? payment.createdAt,
    completed_at: payment.completedAt ?? (payment.status === "COMPLETED" ? payment.createdAt : null)
  };
}

function complimentarySettlementResult(
  order: PosOrderSnapshot,
  requestId: string,
  terminalId: string | null,
  completedAt: number
): CompletedPaymentResult {
  return {
    order_id: order.id,
    order_number: order.order_number,
    payment_id: "complimentary_" + order.id,
    payment_attempt_id: null,
    request_id: requestId,
    payment_method: "COMPLIMENTARY",
    amount: 0,
    received_cash: null,
    change_given: null,
    status: "COMPLETED",
    paid_at: completedAt,
    terminal_id: terminalId,
    provider: "LOCAL",
    provider_transaction_id: null,
    provider_status: "NOT_REQUIRED",
    lifecycle_state: "completed",
    reconciliation_required: false,
    receipt_print_job_id: null,
    failure_reason: null,
    created_at: completedAt,
    updated_at: completedAt,
    completed_at: completedAt
  };
}

function staffOrderItemToBasketLine(item: OrderItem): BasketLine {
  const product = getProductById(item.productId);
  const unitTotal = item.unitPrice;

  return {
    id: "staff_" + item.productId,
    product_id: item.productId,
    product_type: product?.product_type ?? "BASIC",
    product_name: item.productName,
    product_category: product?.category ?? "Staff",
    base_price: item.unitPrice,
    tax_code_id: product?.tax_code_id ?? "vat_81",
    tax_code_name: product?.tax_code_name ?? "VAT 8.1%",
    tax_rate_bps: product?.tax_rate_bps ?? 810,
    station: product?.station_name ?? product?.station ?? "",
    variants: [],
    unit_total: unitTotal,
    quantity: item.quantity,
    complimentary_quantity: 0,
    complimentary_value: 0,
    line_total: item.totalPrice
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
  paymentAttemptId: string | null;
  terminalId: string | null;
  amount: number;
  provider: string;
  providerTransactionId: string | null;
  providerStatus: string;
  lifecycleState: PaymentLifecycleState;
  reconciliationRequired: boolean;
  failureReason: string | null;
}) {
  const payment: LocalPayment = {
    id: scopedId("pay", request.now, 0),
    paymentAttemptId: request.paymentAttemptId,
    requestId: request.requestId,
    orderId: "provider_only_" + request.requestId,
    orderNumber: "Provider only",
    terminalId: request.terminalId,
    amount: request.amount,
    receivedCash: null,
    changeGiven: null,
    method: "WALLEE_TERMINAL",
    status: request.reconciliationRequired ? "PENDING" : "FAILED",
    provider: request.provider,
    providerTransactionId: request.providerTransactionId,
    providerStatus: request.providerStatus,
    lifecycleState: request.lifecycleState,
    receiptPrintJobId: null,
    failureReason: request.failureReason,
    reconciliationRequired: request.reconciliationRequired,
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

function locationIdForTable(tableId: string) {
  return findLayoutTable(tableId)?.floor.location_id ?? null;
}

function findLayoutTable(tableId: string) {
  const layout = getTableLayout();

  for (const floor of layout.floors) {
    for (const area of floor.areas) {
      const table = area.tables.find((entry) => entry.id === tableId);
      if (table) {
        return { floor, area, table };
      }
    }
  }

  return null;
}

function validateOrderSnapshotRequest(request: CreateOrderSnapshotRequest) {
  validateOrderLines(request.lines);

  if (!request.table_context) {
    throw new Error("Cannot create a table order snapshot without table context.");
  }

  validateTableContext(request.table_context);
}

function validateCashPaymentRequest(request: CompleteCashPaymentRequest) {
  validateOrderLines(request.lines);

  if (request.table_context) {
    validateTableContext(request.table_context);
  }

  if (!request.request_id?.trim()) {
    throw new Error("Payment request_id is required.");
  }

  if (request.payment_method !== "CASH") {
    throw new Error("Unsupported local payment method.");
  }
}

function validateWalleeTerminalPaymentRequest(request: StartWalleeTerminalPaymentRequest) {
  validateOrderLines(request.lines);

  if (request.table_context) {
    validateTableContext(request.table_context);
  }

  if (!request.request_id?.trim()) {
    throw new Error("Payment request_id is required.");
  }
}

function validateTableContext(tableContext: TableContext) {
  const layout = getTableLayout(tableContext.location_id);
  const floor = layout.floors.find((entry) => entry.id === tableContext.floor_id);
  const area = floor?.areas.find((entry) => entry.id === tableContext.area_id);
  const table = area?.tables.find((entry) => entry.id === tableContext.table_id);

  if (!floor || !area || !table) {
    throw new Error("Table context is not managed by this LocalMaster.");
  }
}

function isKnownLayoutTable(tableId: string) {
  const layout = getTableLayout();
  return layout.floors.some((floor) =>
    floor.areas.some((area) =>
      area.tables.some((table) => table.id === tableId)
    )
  );
}

function validateCashPaymentAmounts(
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

    const complimentaryQuantity = line.complimentary_quantity ?? 0;
    if (!Number.isInteger(complimentaryQuantity) || complimentaryQuantity < 0 || complimentaryQuantity > line.quantity) {
      throw new Error("Cannot create order snapshot with invalid complimentary quantity for " + line.product_name + ".");
    }

    const expectedComplimentaryValue = line.unit_total * complimentaryQuantity;
    if ((line.complimentary_value ?? 0) !== expectedComplimentaryValue) {
      throw new Error("Cannot create order snapshot because " + line.product_name + " has an inconsistent complimentary value.");
    }

    const expectedLineTotal = line.unit_total * (line.quantity - complimentaryQuantity);

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
