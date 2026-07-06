import { getRelayRuntimeBinding, retryCloudBootstrap } from "./cloudBinding.js";
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
  updateCatalogCategory,
  updateCatalogProduct,
  updateCatalogTax
} from "./catalogStore.js";
import { broadcast } from "./realtime.js";
import { getCatalogSnapshot, pushCatalogToRelay } from "./relayCatalogSync.js";
import { getOperationsSnapshot, pushOperationsToRelay } from "./relayOperationsSync.js";
import { acknowledgeStationPickup, createOrderSnapshot, updateKdsTicketStatus } from "./store.js";
import { beginIdempotentCommand, completeIdempotentCommand, failIdempotentCommand } from "./store/commandStore.js";
import type {
  CatalogCategoryCreateRequest,
  CatalogProductCreateRequest,
  CatalogTaxCreateRequest,
  CreateOrderSnapshotRequest,
  RealtimeEventType
} from "./types.js";

type RelayCommand = {
  command_id: string;
  tenant_id: string;
  location_id: string;
  local_master_instance_id: string;
  type: string;
  status: "pending" | "delivered" | "accepted" | "failed";
  payload: unknown;
};

type RelayCommandList = {
  data: RelayCommand[];
};

let pollTimer: NodeJS.Timeout | null = null;
let isPolling = false;

export function startRelayCommandPolling() {
  if (pollTimer) {
    return;
  }

  const intervalMs = Number(process.env.RELAY_COMMAND_POLL_INTERVAL_MS ?? 2_000);
  pollTimer = setInterval(() => {
    void pollRelayCommands();
  }, Math.max(500, intervalMs));
  pollTimer.unref?.();
  void pollRelayCommands();
}

export function stopRelayCommandPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function pollRelayCommands() {
  if (isPolling) {
    return;
  }

  const binding = getRelayRuntimeBinding();
  if (!binding) {
    return;
  }

  isPolling = true;

  try {
    const response = await fetch(binding.relay_base_url + "/api/local-masters/commands/pending", {
      headers: { Authorization: "Bearer " + binding.relay_token }
    });

    if (!response.ok) {
      console.warn("Relay command poll failed.", response.status, await readRelayError(response));
      return;
    }

    const payload = (await response.json()) as RelayCommandList;
    for (const command of payload.data ?? []) {
      await executeRelayCommand(command, binding);
    }
  } catch (error) {
    console.warn("Relay command poll failed.", error);
  } finally {
    isPolling = false;
  }
}

async function executeRelayCommand(command: RelayCommand, binding: NonNullable<ReturnType<typeof getRelayRuntimeBinding>>) {
  try {
    validateRelayCommandBinding(command, binding);

    if (command.type === "STAFF_ORDER_SNAPSHOT_CREATE") {
      const result = executeStaffOrderCommand(command);
      const operationsSnapshot = binding.location_id ? getOperationsSnapshot(binding.location_id) : null;
      await pushOperationsToRelay(binding);
      await ackRelayCommandSafely(binding, command.command_id, "accepted", {
        entity: result,
        operations_snapshot: operationsSnapshot
      });
      return;
    }

    if (command.type === "STAFF_PICKUP_ACKNOWLEDGE") {
      const result = executeStaffPickupAcknowledgeCommand(command);
      const operationsSnapshot = binding.location_id ? getOperationsSnapshot(binding.location_id) : null;
      await pushOperationsToRelay(binding);
      await ackRelayCommandSafely(binding, command.command_id, "accepted", {
        entity: result,
        operations_snapshot: operationsSnapshot
      });
      return;
    }

    if (command.type === "KDS_TICKET_STATUS_UPDATE") {
      const result = executeKdsTicketStatusCommand(command);
      const operationsSnapshot = binding.location_id ? getOperationsSnapshot(binding.location_id) : null;
      await pushOperationsToRelay(binding);
      await ackRelayCommandSafely(binding, command.command_id, "accepted", {
        entity: result.ticket,
        operations_snapshot: operationsSnapshot
      });
      return;
    }

    if (command.type.startsWith("OWNER_CATALOG_")) {
      await retryCloudBootstrap();
      const result = executeIdempotentOwnerCatalogCommand(command);
      const catalogSnapshot = getCatalogSnapshot();
      await pushCatalogToRelay(binding);
      await ackRelayCommandSafely(binding, command.command_id, "accepted", {
        entity: result,
        catalog_snapshot: catalogSnapshot
      });
      return;
    }

    throw new Error("Unsupported relay command type: " + command.type);
  } catch (error) {
    await ackRelayCommandSafely(
      binding,
      command.command_id,
      "failed",
      null,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function ackRelayCommand(
  relayBaseUrl: string,
  relayToken: string,
  commandId: string,
  status: "accepted" | "failed",
  result: unknown,
  error?: string
) {
  const response = await fetch(relayBaseUrl + "/api/local-masters/commands/" + encodeURIComponent(commandId) + "/ack", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + relayToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status, result, error: error ?? null })
  });

  if (!response.ok) {
    throw new Error("Relay command ACK failed: " + response.status + " " + await readRelayError(response));
  }
}

async function ackRelayCommandSafely(
  binding: NonNullable<ReturnType<typeof getRelayRuntimeBinding>>,
  commandId: string,
  status: "accepted" | "failed",
  result: unknown,
  error?: string
) {
  try {
    await ackRelayCommand(binding.relay_base_url, binding.relay_token, commandId, status, result, error);
  } catch (ackError) {
    console.warn("Relay command ACK failed.", ackError);
  }
}

function validateRelayCommandBinding(
  command: RelayCommand,
  binding: NonNullable<ReturnType<typeof getRelayRuntimeBinding>>
) {
  if (
    command.tenant_id !== binding.tenant_id ||
    command.location_id !== binding.location_id ||
    command.local_master_instance_id !== binding.local_master_instance_id
  ) {
    throw new Error("Relay command does not belong to this LocalMaster binding.");
  }
}

function executeStaffOrderCommand(command: RelayCommand) {
  const request = toCreateOrderSnapshotRequest(command.payload);
  const result = createOrderSnapshot(request);
  const { order, table, kdsTicketsCreated, kdsTicketsUpdated, printJobsCreated, printJobsUpdated } = result;

  if (!result.replayed) {
    broadcast("ORDER_CREATED", { order });
    for (const ticket of kdsTicketsCreated) broadcast("KDS_TICKET_CREATED", { ticket });
    for (const ticket of kdsTicketsUpdated) broadcast("KDS_TICKET_UPDATED", { ticket });
    for (const job of printJobsCreated) broadcast("PRINT_JOB_CREATED", { job });
    for (const job of printJobsUpdated) broadcast("PRINT_JOB_UPDATED", { job });
    broadcast("KDS_TICKETS_REBUILT", { order });
    broadcast("TABLE_UPDATED", { table });
  }

  return order;
}

function executeStaffPickupAcknowledgeCommand(command: RelayCommand) {
  const payload = toStaffPickupAcknowledgePayload(command.payload);
  const pickup = acknowledgeStationPickup(payload.pickup_id);

  broadcast("STATION_PICKUP_ACKNOWLEDGED", { pickup });

  return pickup;
}

function executeKdsTicketStatusCommand(command: RelayCommand) {
  const payload = toKdsTicketStatusPayload(command.payload);
  const result = updateKdsTicketStatus(payload.ticket_id, payload.status);

  broadcast("KDS_TICKET_UPDATED", { ticket: result.ticket });

  if (result.pickup) {
    broadcast("STATION_PICKUP_READY", { pickup: result.pickup });
  }

  return result;
}

function executeIdempotentOwnerCatalogCommand(command: RelayCommand) {
  const handle = beginIdempotentCommand("RELAY_OWNER_CATALOG_COMMAND", command.command_id, command.payload);
  if (handle.mode === "replay") {
    return handle.result;
  }

  try {
    return completeIdempotentCommand(handle.entry, executeOwnerCatalogCommand(command));
  } catch (error) {
    failIdempotentCommand(handle.entry, error);
  }
}

function executeOwnerCatalogCommand(command: RelayCommand) {
  const payload = toOwnerCatalogPayload(command.payload);
  let result: unknown;

  switch (payload.action) {
    case "OWNER_CATALOG_PRODUCT_CREATE":
      result = createCatalogProduct(payload.payload as CatalogProductCreateRequest);
      break;
    case "OWNER_CATALOG_PRODUCT_UPDATE":
      result = updateCatalogProduct(required(payload.payload.product_id, "product_id is required."), payload.payload.input ?? {});
      break;
    case "OWNER_CATALOG_PRODUCT_DELETE":
      deleteCatalogProduct(required(payload.payload.product_id, "product_id is required."));
      result = { id: payload.payload.product_id };
      break;
    case "OWNER_CATALOG_PRODUCT_DUPLICATE":
      result = duplicateCatalogProduct(required(payload.payload.product_id, "product_id is required."));
      break;
    case "OWNER_CATALOG_CATEGORY_CREATE":
      result = createCatalogCategory(payload.payload as CatalogCategoryCreateRequest);
      break;
    case "OWNER_CATALOG_CATEGORY_UPDATE":
      result = updateCatalogCategory(required(payload.payload.category_id, "category_id is required."), payload.payload.input ?? {});
      break;
    case "OWNER_CATALOG_CATEGORY_DELETE":
      deleteCatalogCategory(required(payload.payload.category_id, "category_id is required."));
      result = { id: payload.payload.category_id };
      break;
    case "OWNER_CATALOG_CATEGORY_DUPLICATE":
      result = duplicateCatalogCategory(required(payload.payload.category_id, "category_id is required."));
      break;
    case "OWNER_CATALOG_TAX_CREATE":
      result = createCatalogTax(payload.payload as CatalogTaxCreateRequest);
      break;
    case "OWNER_CATALOG_TAX_UPDATE":
      result = updateCatalogTax(required(payload.payload.tax_id, "tax_id is required."), payload.payload.input ?? {});
      break;
    case "OWNER_CATALOG_TAX_DELETE":
      deleteCatalogTax(required(payload.payload.tax_id, "tax_id is required."));
      result = { id: payload.payload.tax_id };
      break;
    case "OWNER_CATALOG_TAX_DUPLICATE":
      result = duplicateCatalogTax(required(payload.payload.tax_id, "tax_id is required."));
      break;
    default:
      throw new Error("Unsupported owner catalog action: " + payload.action);
  }

  broadcast("CATALOG_UPDATED", { action: payload.action, entity: result });
  return result;
}

function toCreateOrderSnapshotRequest(payload: unknown): CreateOrderSnapshotRequest {
  if (!payload || typeof payload !== "object") {
    throw new Error("Relay command payload is invalid.");
  }

  const request = payload as Partial<CreateOrderSnapshotRequest>;
  if (!request.request_id || !Array.isArray(request.lines)) {
    throw new Error("Relay order command payload is invalid.");
  }

  return {
    request_id: request.request_id,
    lines: request.lines,
    table_context: request.table_context ?? null
  };
}

function toStaffPickupAcknowledgePayload(payload: unknown): { pickup_id: string } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Relay pickup acknowledge payload is invalid.");
  }

  const command = payload as { pickup_id?: unknown };
  return {
    pickup_id: required(command.pickup_id, "pickup_id is required.")
  };
}

function toKdsTicketStatusPayload(payload: unknown): { ticket_id: string; status: "OPEN" | "IN_PROGRESS" | "DONE" } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Relay KDS ticket status payload is invalid.");
  }

  const command = payload as { ticket_id?: unknown; status?: unknown };
  const status = required(command.status, "status is required.");
  if (status !== "OPEN" && status !== "IN_PROGRESS" && status !== "DONE") {
    throw new Error("KDS ticket status is invalid.");
  }

  return {
    ticket_id: required(command.ticket_id, "ticket_id is required."),
    status
  };
}

function toOwnerCatalogPayload(payload: unknown): { action: string; payload: Record<string, any> } {
  if (!payload || typeof payload !== "object") {
    throw new Error("Relay owner catalog command payload is invalid.");
  }

  const command = payload as { action?: string; payload?: unknown };
  if (!command.action || !command.action.startsWith("OWNER_CATALOG_")) {
    throw new Error("Relay owner catalog command action is invalid.");
  }

  return {
    action: command.action,
    payload: command.payload && typeof command.payload === "object" ? command.payload as Record<string, any> : {}
  };
}

function required(value: unknown, message: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(message);
  return normalized;
}

async function readRelayError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? response.statusText;
  } catch {
    return (await response.text().catch(() => "")) || response.statusText;
  }
}
