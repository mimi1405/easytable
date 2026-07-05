import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import { locations, relayCommands } from "../db/schema.js";
import type {
  RelayCommand,
  StaffLoginRequest,
  StaffLoginResponse,
  StaffOrderSnapshotRelayRequest,
  StaffRelayCommandResponse,
  TenantUserRole
} from "../types.js";
import { ApiError } from "./errors.js";
import { authenticateLocationUserByPin } from "./userStore.js";

type RelayCommandRow = typeof relayCommands.$inferSelect;

export type StaffSession = {
  tenant_id: string;
  location_id: string;
  user_id: string;
  display_name: string;
  role: TenantUserRole;
  exp: number;
};

const staffSessionTtlMs = 12 * 60 * 60 * 1000;

export async function loginStaff(request: StaffLoginRequest): Promise<StaffLoginResponse> {
  const tenantId = normalizeRequiredText(request.tenant_id, "Tenant is required.");
  const locationId = normalizeRequiredText(request.location_id, "Location is required.");
  const user = await authenticateLocationUserByPin(tenantId, locationId, request.email, request.pin);
  const expiresAt = new Date(Date.now() + staffSessionTtlMs);
  const session: StaffSession = {
    tenant_id: tenantId,
    location_id: locationId,
    user_id: user.user_id,
    display_name: user.display_name,
    role: user.role,
    exp: expiresAt.getTime()
  };

  return {
    access_token: signStaffSession(session),
    tenant_id: tenantId,
    location_id: locationId,
    user_id: user.user_id,
    display_name: user.display_name,
    role: user.role,
    expires_at: expiresAt.toISOString()
  };
}

export async function createStaffOrderRelayCommand(
  authorization: string | undefined,
  locationId: string,
  request: StaffOrderSnapshotRelayRequest
): Promise<StaffRelayCommandResponse> {
  const session = requireStaffSession(authorization);
  if (session.location_id !== locationId) {
    throw new ApiError("Staff session does not belong to this location.", 403);
  }

  const location = await requireRelayLocation(session.tenant_id, locationId);
  const requestId = normalizeRequiredText(request.request_id, "request_id is required.");
  const commandId = commandIdForStaffOrder(session.tenant_id, locationId, requestId);
  const payload = {
    request_id: requestId,
    lines: Array.isArray(request.lines) ? request.lines : [],
    table_context: request.table_context,
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

  return toStaffRelayCommand(rows[0]);
}

export async function createStaffPickupAcknowledgeRelayCommand(
  authorization: string | undefined,
  locationId: string,
  pickupId: string,
  request: { request_id?: string }
): Promise<StaffRelayCommandResponse> {
  const session = requireStaffSession(authorization);
  if (session.location_id !== locationId) {
    throw new ApiError("Staff session does not belong to this location.", 403);
  }

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

  return toStaffRelayCommand(rows[0]);
}

export async function createKdsTicketStatusRelayCommand(
  authorization: string | undefined,
  locationId: string,
  ticketId: string,
  request: { request_id?: string; status?: string }
): Promise<StaffRelayCommandResponse> {
  const session = requireStaffSession(authorization);
  if (session.location_id !== locationId) {
    throw new ApiError("Staff session does not belong to this location.", 403);
  }

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

  return toStaffRelayCommand(rows[0]);
}

export async function getStaffRelayCommand(
  authorization: string | undefined,
  commandId: string
): Promise<StaffRelayCommandResponse> {
  const session = requireStaffSession(authorization);
  const row = await getRelayCommand(session, commandId);

  if (!row) {
    throw new ApiError("Relay command not found.", 404);
  }

  return toStaffRelayCommand(row);
}

export function requireStaffSession(authorization: string | undefined): StaffSession {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token) {
    throw new ApiError("Staff session is required.", 401);
  }

  const devSession = readDevStaffSession(token);
  if (devSession) {
    return devSession;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new ApiError("Staff session is invalid.", 401);
  }

  const expectedSignature = sign(encodedPayload);
  const actual = Buffer.from(signature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ApiError("Staff session is invalid.", 401);
  }

  const session = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<StaffSession>;
  if (!session.tenant_id || !session.location_id || !session.user_id || !session.role || !session.exp || session.exp <= Date.now()) {
    throw new ApiError("Staff session is expired or invalid.", 401);
  }

  return session as StaffSession;
}

function readDevStaffSession(token: string): StaffSession | null {
  if (process.env.RELAY_DEV_AUTH_DISABLED !== "1" || !token.startsWith("dev.")) {
    return null;
  }

  try {
    const encodedPayload = token.slice("dev.".length);
    const session = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<StaffSession>;
    if (!session.tenant_id || !session.location_id || !session.user_id || !session.role) {
      throw new Error("Dev relay context is incomplete.");
    }

    return {
      tenant_id: session.tenant_id,
      location_id: session.location_id,
      user_id: session.user_id,
      display_name: session.display_name ?? "Dev User",
      role: session.role,
      exp: session.exp ?? Date.now() + staffSessionTtlMs
    };
  } catch {
    throw new ApiError("Dev staff relay context is invalid.", 401);
  }
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

function signStaffSession(session: StaffSession) {
  const encodedPayload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return encodedPayload + "." + sign(encodedPayload);
}

function sign(encodedPayload: string) {
  return createHmac("sha256", staffSessionSecret()).update(encodedPayload).digest("base64url");
}

function staffSessionSecret() {
  return process.env.STAFF_SESSION_SECRET ?? process.env.ADMIN_API_TOKEN ?? "easytable-dev-staff-session-secret";
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
