import { and, eq } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import {
  localMasterOutboxEvents,
  orderSnapshotLines,
  orderSnapshots,
  salesLedgerEntries
} from "../db/schema.js";
import type {
  BasketLine,
  LocalMasterFinancialEvent,
  LocalMasterFinancialEventsRequest,
  LocalMasterFinancialEventsResponse
} from "../types.js";
import { ApiError } from "./errors.js";
import { requireLocalMasterCredential } from "./provisioningStore.js";

type Credential = Awaited<ReturnType<typeof requireLocalMasterCredential>>;

export async function ingestLocalMasterFinancialEvents(
  relayToken: string,
  request: LocalMasterFinancialEventsRequest
): Promise<LocalMasterFinancialEventsResponse> {
  const credential = await requireLocalMasterCredential(relayToken);

  if (request.tenant_id && request.tenant_id !== credential.tenantId) {
    throw new ApiError("Financial event tenant does not match this LocalMaster.", 403);
  }
  if (request.location_id && request.location_id !== credential.locationId) {
    throw new ApiError("Financial event location does not match this LocalMaster.", 403);
  }
  if (request.local_master_instance_id && request.local_master_instance_id !== credential.localMasterInstanceId) {
    throw new ApiError("Financial event LocalMaster instance does not match this credential.", 403);
  }
  if (!Array.isArray(request.events)) {
    throw new ApiError("Financial events must be an array.", 400);
  }

  const acceptedEventIds: string[] = [];
  const failedEvents: Array<{ id: string; error: string }> = [];

  for (const event of request.events) {
    try {
      await processFinancialEvent(credential, event);
      acceptedEventIds.push(event.id);
    } catch (error) {
      failedEvents.push({
        id: event.id || "unknown",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { accepted_event_ids: acceptedEventIds, failed_events: failedEvents };
}

async function processFinancialEvent(credential: Credential, event: LocalMasterFinancialEvent) {
  if (!event?.id || !event.event_type || !event.aggregate_id) {
    throw new ApiError("Financial event is missing required fields.", 400);
  }

  const now = new Date();
  await getDrizzleDatabase().transaction(async (tx) => {
    await tx.insert(localMasterOutboxEvents)
      .values({
        id: event.id,
        tenantId: credential.tenantId,
        locationId: credential.locationId,
        localMasterInstanceId: credential.localMasterInstanceId,
        eventType: event.event_type,
        aggregateId: event.aggregate_id,
        payloadJson: event.payload,
        localCreatedAt: toDate(event.created_at),
        processedAt: now,
        error: null,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: localMasterOutboxEvents.id,
        set: {
          payloadJson: event.payload,
          processedAt: now,
          error: null,
          updatedAt: now
        }
      });

    if (event.event_type === "ORDER_SNAPSHOT_RECORDED") {
      await upsertSnapshot(tx, credential, event.payload);
      return;
    }

    if (event.event_type === "ORDER_STORNO_RECORDED") {
      const result = event.payload as { ledger_entries?: unknown };
      await upsertLedgerEntries(tx, credential, result.ledger_entries);
      return;
    }

    if (event.event_type === "SALES_LEDGER_UPDATED") {
      const payload = event.payload as { ledger_entries?: unknown };
      await upsertLedgerEntries(tx, credential, payload.ledger_entries);
      return;
    }

    if (event.event_type === "PAYMENT_COMPLETED" || event.event_type === "DAY_CLOSE_SAVED") {
      return;
    }

    throw new ApiError("Unsupported financial event type: " + event.event_type, 400);
  });
}

async function upsertSnapshot(tx: Parameters<Parameters<ReturnType<typeof getDrizzleDatabase>["transaction"]>[0]>[0], credential: Credential, payload: unknown) {
  const snapshot = payload as {
    id?: string;
    order_id?: string;
    order_number?: string;
    snapshot_type?: string;
    table_context?: unknown;
    actor?: unknown;
    lines?: BasketLine[];
    subtotal?: number;
    tax_total?: number;
    total?: number;
    payment?: {
      payment_id?: string;
      request_id?: string;
      method?: string;
      amount?: number;
      terminal_id?: string | null;
      provider?: string;
      provider_transaction_id?: string | null;
      provider_status?: string;
      lifecycle_state?: string;
      paid_at?: number;
    };
    terminal_id?: string | null;
    business_date?: string;
    created_at?: number;
  };

  if (!snapshot.id || !snapshot.order_id || !snapshot.payment?.payment_id) {
    throw new ApiError("Snapshot payload is incomplete.", 400);
  }

  const now = new Date();
  await tx.insert(orderSnapshots)
    .values({
      id: snapshot.id,
      tenantId: credential.tenantId,
      locationId: credential.locationId,
      localMasterInstanceId: credential.localMasterInstanceId,
      orderId: snapshot.order_id,
      orderNumber: required(snapshot.order_number, "Snapshot order number is required."),
      snapshotType: snapshot.snapshot_type ?? "PAID",
      tableContextJson: snapshot.table_context ?? null,
      actorJson: snapshot.actor ?? null,
      subtotal: integer(snapshot.subtotal, "Snapshot subtotal is invalid."),
      taxTotal: integer(snapshot.tax_total, "Snapshot tax total is invalid."),
      total: integer(snapshot.total, "Snapshot total is invalid."),
      paymentId: snapshot.payment.payment_id,
      paymentRequestId: required(snapshot.payment.request_id, "Payment request id is required."),
      paymentMethod: required(snapshot.payment.method, "Payment method is required."),
      paymentAmount: integer(snapshot.payment.amount, "Payment amount is invalid."),
      paymentTerminalId: snapshot.payment.terminal_id ?? null,
      provider: required(snapshot.payment.provider, "Payment provider is required."),
      providerTransactionId: snapshot.payment.provider_transaction_id ?? null,
      providerStatus: required(snapshot.payment.provider_status, "Provider status is required."),
      paymentLifecycleState: required(snapshot.payment.lifecycle_state, "Payment lifecycle state is required."),
      paidAt: toDate(snapshot.payment.paid_at),
      terminalId: snapshot.terminal_id ?? null,
      businessDate: required(snapshot.business_date, "Business date is required."),
      localCreatedAt: toDate(snapshot.created_at),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: orderSnapshots.id,
      set: {
        total: integer(snapshot.total, "Snapshot total is invalid."),
        updatedAt: now
      }
    });

  for (const line of Array.isArray(snapshot.lines) ? snapshot.lines : []) {
    await tx.insert(orderSnapshotLines)
      .values({
        id: snapshot.id + ":" + line.id,
        tenantId: credential.tenantId,
        locationId: credential.locationId,
        localMasterInstanceId: credential.localMasterInstanceId,
        snapshotId: snapshot.id,
        orderId: snapshot.order_id,
        lineId: required(line.id, "Snapshot line id is required."),
        productId: line.product_id ?? "",
        productType: line.product_type,
        productName: required(line.product_name, "Product name is required."),
        productCategory: line.product_category ?? "",
        basePrice: integer(line.base_price, "Base price is invalid."),
        taxCodeId: line.tax_code_id ?? "",
        taxCodeName: line.tax_code_name ?? "",
        taxRateBps: integer(line.tax_rate_bps, "Tax rate is invalid."),
        station: line.station ?? "",
        variantsJson: line.variants ?? [],
        unitTotal: integer(line.unit_total, "Unit total is invalid."),
        quantity: integer(line.quantity, "Quantity is invalid."),
        complimentaryQuantity: integer(line.complimentary_quantity ?? 0, "Complimentary quantity is invalid."),
        complimentaryValue: integer(line.complimentary_value ?? 0, "Complimentary value is invalid."),
        lineTotal: integer(line.line_total, "Line total is invalid."),
        localCreatedAt: toDate(snapshot.created_at),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: orderSnapshotLines.id,
        set: {
          quantity: integer(line.quantity, "Quantity is invalid."),
          complimentaryQuantity: integer(line.complimentary_quantity ?? 0, "Complimentary quantity is invalid."),
          complimentaryValue: integer(line.complimentary_value ?? 0, "Complimentary value is invalid."),
          lineTotal: integer(line.line_total, "Line total is invalid."),
          updatedAt: now
        }
      });
  }
}

async function upsertLedgerEntries(tx: Parameters<Parameters<ReturnType<typeof getDrizzleDatabase>["transaction"]>[0]>[0], credential: Credential, payload: unknown) {
  if (!Array.isArray(payload)) {
    return;
  }
  const now = new Date();
  for (const entry of payload as Array<Record<string, unknown>>) {
    if (!entry.id || !entry.order_id) {
      throw new ApiError("Ledger entry payload is incomplete.", 400);
    }
    await tx.insert(salesLedgerEntries)
      .values({
        id: String(entry.id),
        tenantId: credential.tenantId,
        locationId: credential.locationId,
        localMasterInstanceId: credential.localMasterInstanceId,
        requestId: String(entry.request_id ?? ""),
        entryType: String(entry.entry_type ?? ""),
        orderId: String(entry.order_id),
        orderNumber: String(entry.order_number ?? ""),
        paymentId: nullableString(entry.payment_id),
        originalEntryId: nullableString(entry.original_entry_id),
        lineId: nullableString(entry.line_id),
        productId: nullableString(entry.product_id),
        productName: nullableString(entry.product_name),
        productCategory: nullableString(entry.product_category),
        taxCodeId: nullableString(entry.tax_code_id),
        taxRateBps: integer(entry.tax_rate_bps ?? 0, "Ledger tax rate is invalid."),
        quantity: integer(entry.quantity, "Ledger quantity is invalid."),
        grossAmount: integer(entry.gross_amount, "Ledger gross amount is invalid."),
        taxAmount: integer(entry.tax_amount, "Ledger tax amount is invalid."),
        complimentaryValue: integer(entry.complimentary_value ?? 0, "Ledger complimentary value is invalid."),
        actorUserId: nullableString(entry.actor_user_id),
        actorDisplayName: nullableString(entry.actor_display_name),
        actorRole: nullableString(entry.actor_role),
        actorDeviceId: nullableString(entry.actor_device_id),
        paymentMethod: nullableString(entry.payment_method),
        terminalId: nullableString(entry.terminal_id),
        provider: nullableString(entry.provider),
        providerTransactionId: nullableString(entry.provider_transaction_id),
        providerRefundId: nullableString(entry.provider_refund_id),
        providerStatus: nullableString(entry.provider_status),
        reason: nullableString(entry.reason),
        businessDate: String(entry.business_date ?? ""),
        occurredAt: toDate(entry.occurred_at),
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: salesLedgerEntries.id,
        set: {
          grossAmount: integer(entry.gross_amount, "Ledger gross amount is invalid."),
          taxAmount: integer(entry.tax_amount, "Ledger tax amount is invalid."),
          complimentaryValue: integer(entry.complimentary_value ?? 0, "Ledger complimentary value is invalid."),
          updatedAt: now
        }
      });
  }
}

function required(value: string | undefined | null, message: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new ApiError(message, 400);
  return normalized;
}

function integer(value: unknown, message: string) {
  if (!Number.isInteger(value)) throw new ApiError(message, 400);
  return value as number;
}

function toDate(value: unknown) {
  if (!Number.isFinite(value)) throw new ApiError("Timestamp is invalid.", 400);
  return new Date(value as number);
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
