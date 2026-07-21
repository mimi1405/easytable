import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { and, eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../auth.js";
import { getDrizzleDatabase } from "../db/client.js";
import { locations, relayCommands, tenantUserLocations, tenantUsers, users } from "../db/schema.js";
import { publishCommandEvent } from "../lib/nats.js";
import { broadcastRelayLocationEvent } from "../lib/realtime.js";
import type {
  RelayCommand,
  StaffComplimentaryAdjustRelayRequest,
  StaffOrderSnapshotRelayRequest,
  StaffRelayCommandResponse,
  TenantUserRole
} from "../types.js";
import { ApiError } from "./errors.js";

type RelayCommandRow = typeof relayCommands.$inferSelect;

export type StaffSession = {
  tenant_id: string;
  location_id: string;
  user_id: string;
  display_name: string;
  role: TenantUserRole;
  exp: number;
};

export async function createStaffOrderRelayCommand(
  headers: IncomingHttpHeaders,
  locationId: string,
  request: StaffOrderSnapshotRelayRequest
): Promise<StaffRelayCommandResponse> {
  const session = await requireStaffSession(headers, locationId);

  const location = await requireRelayLocation(session.tenant_id, locationId);
  const requestId = normalizeRequiredText(request.request_id, "request_id is required.");
  const commandId = commandIdForStaffOrder(session.tenant_id, locationId, requestId);
  const payload = {
    request_id: requestId,
    lines: Array.isArray(request.lines) ? request.lines : [],
    table_context: request.table_context,
    actor: {
      user_id: session.user_id,
      display_name: session.display_name,
      role: session.role,
      device_id: "relay_staff",
      terminal_id: null
    },
    submitted_by: {
      user_id: session.user_id,
      display_name: session.display_name,
      role: session.role
    }
  };
  const existing = await getRelayCommand(session, commandId);

  if (existing) {
    if (fingerprint(existing.payloadJson) !== fingerprint(payload)) {
      throw new ApiError("request_id was already used with a different payload.", 409);
    }

    return toStaffRelayCommand(existing);
  }

  const rows = await getDrizzleDatabase()
    .insert(relayCommands)
    .values({
      id: commandId,
      tenantId: session.tenant_id,
      locationId,
      localMasterInstanceId: location.localMasterInstanceId,
      type: "STAFF_ORDER_SNAPSHOT_CREATE",
      status: "pending",
      payloadJson: payload,
      resultJson: null,
      deliveredAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .returning();

  if (rows[0] && location.localMasterInstanceId) {
    void publishCommandEvent(session.tenant_id, locationId, location.localMasterInstanceId, commandId);
    broadcastRelayLocationEvent(session.tenant_id, locationId, {
      type: "RELAY_COMMAND_UPDATED",
      payload: toStaffRelayCommand(rows[0]),
    });
  }

  return toStaffRelayCommand(rows[0]);
}

export async function createStaffComplimentaryAdjustRelayCommand(
  headers: IncomingHttpHeaders,
  locationId: string,
  orderId: string,
  request: StaffComplimentaryAdjustRelayRequest
): Promise<StaffRelayCommandResponse> {
  const session = await requireStaffSession(headers, locationId);
  const location = await requireRelayLocation(session.tenant_id, locationId);
  const requestId = normalizeRequiredText(request.request_id, "request_id is required.");
  const commandId = "staff_complimentary_" + createHash("sha256")
    .update(session.tenant_id + ":" + locationId + ":" + requestId).digest("hex");
  const payload = {
    request_id: requestId,
    order_id: normalizeRequiredText(orderId, "order_id is required."),
    line_id: normalizeRequiredText(request.line_id, "line_id is required."),
    complimentary_quantity: request.complimentary_quantity,
    actor: {
      user_id: session.user_id,
      display_name: session.display_name,
      role: session.role,
      device_id: "relay_staff",
      terminal_id: null
    }
  };
  const existing = await getRelayCommand(session, commandId);
  if (existing) {
    if (fingerprint(existing.payloadJson) !== fingerprint(payload)) {
      throw new ApiError("request_id was already used with a different payload.", 409);
    }
    return toStaffRelayCommand(existing);
  }
  const rows = await getDrizzleDatabase().insert(relayCommands).values({
    id: commandId,
    tenantId: session.tenant_id,
    locationId,
    localMasterInstanceId: location.localMasterInstanceId,
    type: "STAFF_COMPLIMENTARY_ADJUST",
    status: "pending",
    payloadJson: payload,
    resultJson: null,
    deliveredAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }).returning();
  if (rows[0] && location.localMasterInstanceId) {
    void publishCommandEvent(session.tenant_id, locationId, location.localMasterInstanceId, commandId);
    broadcastRelayLocationEvent(session.tenant_id, locationId, {
      type: "RELAY_COMMAND_UPDATED",
      payload: toStaffRelayCommand(rows[0])
    });
  }
  return toStaffRelayCommand(rows[0]);
}

export async function createStaffPickupAcknowledgeRelayCommand(
  headers: IncomingHttpHeaders,
  locationId: string,
  pickupId: string,
  request: { request_id?: string }
): Promise<StaffRelayCommandResponse> {
  const session = await requireStaffSession(headers, locationId);

  const location = await requireRelayLocation(session.tenant_id, locationId);
  const normalizedPickupId = normalizeRequiredText(pickupId, "pickup_id is required.");
  const requestId = normalizeRequiredText(request.request_id, "request_id is required.");
  const commandId = "staff_pickup_ack_" + createHash("sha256").update(session.tenant_id + ":" + locationId + ":" + requestId).digest("hex");
  const payload = {
    request_id: requestId,
    pickup_id: normalizedPickupId,
    submitted_by: {
      user_id: session.user_id,
      display_name: session.display_name,
      role: session.role
    }
  };
  const existing = await getRelayCommand(session, commandId);

  if (existing) {
    if (fingerprint(existing.payloadJson) !== fingerprint(payload)) {
      throw new ApiError("request_id was already used with a different payload.", 409);
    }

    return toStaffRelayCommand(existing);
  }

  const rows = await getDrizzleDatabase()
    .insert(relayCommands)
    .values({
      id: commandId,
      tenantId: session.tenant_id,
      locationId,
      localMasterInstanceId: location.localMasterInstanceId,
      type: "STAFF_PICKUP_ACKNOWLEDGE",
      status: "pending",
      payloadJson: payload,
      resultJson: null,
      deliveredAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .returning();

  if (rows[0] && location.localMasterInstanceId) {
    void publishCommandEvent(session.tenant_id, locationId, location.localMasterInstanceId, commandId);
    broadcastRelayLocationEvent(session.tenant_id, locationId, {
      type: "RELAY_COMMAND_UPDATED",
      payload: toStaffRelayCommand(rows[0]),
    });
  }

  return toStaffRelayCommand(rows[0]);
}

export async function createKdsTicketStatusRelayCommand(
  headers: IncomingHttpHeaders,
  locationId: string,
  ticketId: string,
  request: { request_id?: string; status?: string }
): Promise<StaffRelayCommandResponse> {
  const session = await requireStaffSession(headers, locationId);

  const location = await requireRelayLocation(session.tenant_id, locationId);
  const normalizedTicketId = normalizeRequiredText(ticketId, "ticket_id is required.");
  const requestId = normalizeRequiredText(request.request_id, "request_id is required.");
  const status = normalizeKdsStatus(request.status);
  const commandId = "kds_ticket_status_" + createHash("sha256").update(session.tenant_id + ":" + locationId + ":" + requestId).digest("hex");
  const payload = {
    request_id: requestId,
    ticket_id: normalizedTicketId,
    status,
    submitted_by: {
      user_id: session.user_id,
      display_name: session.display_name,
      role: session.role
    }
  };
  const existing = await getRelayCommand(session, commandId);

  if (existing) {
    if (fingerprint(existing.payloadJson) !== fingerprint(payload)) {
      throw new ApiError("request_id was already used with a different payload.", 409);
    }

    return toStaffRelayCommand(existing);
  }

  const rows = await getDrizzleDatabase()
    .insert(relayCommands)
    .values({
      id: commandId,
      tenantId: session.tenant_id,
      locationId,
      localMasterInstanceId: location.localMasterInstanceId,
      type: "KDS_TICKET_STATUS_UPDATE",
      status: "pending",
      payloadJson: payload,
      resultJson: null,
      deliveredAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .returning();

  if (rows[0] && location.localMasterInstanceId) {
    void publishCommandEvent(session.tenant_id, locationId, location.localMasterInstanceId, commandId);
    broadcastRelayLocationEvent(session.tenant_id, locationId, {
      type: "RELAY_COMMAND_UPDATED",
      payload: toStaffRelayCommand(rows[0]),
    });
  }

  return toStaffRelayCommand(rows[0]);
}

export async function getStaffRelayCommand(
  headers: IncomingHttpHeaders,
  commandId: string
): Promise<StaffRelayCommandResponse> {
  const row = (await getDrizzleDatabase()
    .select()
    .from(relayCommands)
    .where(eq(relayCommands.id, commandId))
    .limit(1))[0] ?? null;

  if (!row) {
    throw new ApiError("Relay command not found.", 404);
  }

  const session = await requireStaffSession(headers, row.locationId);
  if (session.tenant_id !== row.tenantId) {
    throw new ApiError("Relay command not found.", 404);
  }

  return toStaffRelayCommand(row);
}

export async function requireStaffSession(headers: IncomingHttpHeaders, locationId?: string): Promise<StaffSession> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });

  if (!session) {
    throw new ApiError("Staff session is required.", 401);
  }

  const db = getDrizzleDatabase();
  const filters = [
    eq(tenantUserLocations.userId, session.user.id),
    eq(tenantUserLocations.isActive, 1),
  ];
  if (locationId) {
    filters.push(eq(tenantUserLocations.locationId, locationId));
  }

  const rows = await db
    .select({
      tenantId: tenantUserLocations.tenantId,
      locationId: tenantUserLocations.locationId,
      role: tenantUsers.role,
      displayName: users.name,
      status: users.status,
    })
    .from(tenantUserLocations)
    .innerJoin(
      tenantUsers,
      and(
        eq(tenantUsers.tenantId, tenantUserLocations.tenantId),
        eq(tenantUsers.userId, tenantUserLocations.userId)
      )
    )
    .innerJoin(users, eq(users.id, tenantUserLocations.userId))
    .where(and(...filters))
    .limit(1);

  const relation = rows[0];
  if (!relation || relation.status !== "ACTIVE") {
    throw new ApiError("Staff session does not have access to this location.", 403);
  }

  const role = relation.role as TenantUserRole;
  if (role !== "OWNER" && role !== "MANAGER" && role !== "STAFF" && role !== "KDS") {
    throw new ApiError("Staff session role is not allowed for this location.", 403);
  }

  return {
    tenant_id: relation.tenantId,
    location_id: relation.locationId,
    user_id: session.user.id,
    display_name: relation.displayName,
    role,
    exp: new Date(session.session.expiresAt).getTime()
  };
}

export async function requireRelayLocation(tenantId: string, locationId: string) {
  const row = (await getDrizzleDatabase()
    .select({
      id: locations.id,
      localMasterInstanceId: locations.localMasterInstanceId,
      status: locations.status
    })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .limit(1))[0];

  if (!row) {
    throw new ApiError("Location not found.", 404);
  }

  if (row.status !== "ACTIVE") {
    throw new ApiError("Location is suspended.", 409);
  }

  if (!row.localMasterInstanceId) {
    throw new ApiError("Location is not paired with a LocalMaster.", 409);
  }

  return { ...row, localMasterInstanceId: row.localMasterInstanceId };
}

async function getRelayCommand(session: StaffSession, commandId: string) {
  return (await getDrizzleDatabase()
    .select()
    .from(relayCommands)
    .where(and(
      eq(relayCommands.id, commandId),
      eq(relayCommands.tenantId, session.tenant_id),
      eq(relayCommands.locationId, session.location_id)
    ))
    .limit(1))[0] ?? null;
}

function toStaffRelayCommand(row: RelayCommandRow): StaffRelayCommandResponse {
  const command = toRelayCommand(row);
  return {
    ...command,
    poll_url: "/api/staff/commands/" + encodeURIComponent(command.command_id)
  };
}

function toRelayCommand(row: RelayCommandRow): RelayCommand {
  return {
    command_id: row.id,
    tenant_id: row.tenantId,
    location_id: row.locationId,
    local_master_instance_id: row.localMasterInstanceId,
    type: row.type,
    status: row.status,
    payload: row.payloadJson,
    result: row.resultJson ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function commandIdForStaffOrder(tenantId: string, locationId: string, requestId: string) {
  return "staff_order_" + createHash("sha256").update(tenantId + ":" + locationId + ":" + requestId).digest("hex");
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "__undefined";
  }

  if (Array.isArray(value)) {
    return "[" + value.map((item) => stableStringify(item)).join(",") + "]";
  }

  return "{" + Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => JSON.stringify(key) + ":" + stableStringify(item))
    .join(",") + "}";
}

function normalizeRequiredText(value: string | undefined, message: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new ApiError(message);
  return normalized;
}

function normalizeKdsStatus(value: string | undefined) {
  if (value !== "OPEN" && value !== "IN_PROGRESS" && value !== "DONE") {
    throw new ApiError("KDS ticket status is invalid.", 400);
  }

  return value;
}
