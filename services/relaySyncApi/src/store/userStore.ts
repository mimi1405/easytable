import { pbkdf2Sync, randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";

import { auth } from "../auth.js";
import { getDrizzleDatabase } from "../db/client.js";
import { accounts, locations, tenantUserLocations, tenantUsers, tenants, users, verifications } from "../db/schema.js";
import type {
  TenantLocationUser,
  TenantLocationUserCreateRequest,
  TenantLocationUserResetPasswordRequest,
  TenantLocationUserResetPasswordResponse,
  TenantLocationUserResetPinRequest,
  TenantLocationUserResetPinResponse,
  TenantLocationUserUpdateRequest,
  TenantUserRole
} from "../types.js";
import { triggerLocalMasterBootstrapRefresh } from "./adminSync.js";
import { sendAccountSetupLink } from "./accountSetupStore.js";
import { ApiError } from "./errors.js";
import { requireStaffSession } from "./staffRelayStore.js";

type UserRow = typeof users.$inferSelect;
type TenantUserRow = typeof tenantUsers.$inferSelect;
type TenantUserLocationRow = typeof tenantUserLocations.$inferSelect;
type LocationUserRow = { user: UserRow; tenantUser: TenantUserRow; locationUser: TenantUserLocationRow; hasPassword: boolean };

const allowedRoles: TenantUserRole[] = ["OWNER", "MANAGER", "STAFF", "KDS", "POS_OPERATOR"];

export async function listLocationUsers(tenantId: string, locationId: string): Promise<TenantLocationUser[]> {
  await requireLocation(tenantId, locationId);
  const rows = await getLocationUserRows(tenantId, locationId);

  return rows.map(({ user, tenantUser, locationUser, hasPassword }) =>
    toTenantLocationUser(tenantId, locationId, user, tenantUser, locationUser, hasPassword)
  );
}

export async function createLocationUser(
  tenantId: string,
  locationId: string,
  request: TenantLocationUserCreateRequest
): Promise<TenantLocationUser> {
  await requireLocation(tenantId, locationId);
  const input = normalizeUserInput(request, true);
  const now = new Date();
  const db = getDrizzleDatabase();
  const passwordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;
  const internalPassword = generateTemporaryPassword();
  const existingUsers = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${input.email})`)
    .limit(1);
  let userId = existingUsers[0]?.id;

  if (!userId) {
    await auth.api.signUpEmail({
      body: {
        email: input.email,
        password: input.password ?? internalPassword,
        name: input.display_name,
      },
    });

    const createdUsers = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${input.email})`)
      .limit(1);

    userId = createdUsers[0]?.id;
  }

  if (!userId) {
    throw new ApiError("Better Auth user could not be created.", 500);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        email: input.email,
        name: input.display_name,
        role: "user",
        status: input.status,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    if (passwordHash !== undefined) {
      await upsertCredentialPassword(tx, userId, passwordHash, now);
    }

    await tx
      .insert(tenantUsers)
      .values({
        tenantId,
        userId,
        role: input.role,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [tenantUsers.tenantId, tenantUsers.userId],
        set: { role: input.role, updatedAt: now },
      });

    await tx
      .insert(tenantUserLocations)
      .values({
        tenantId,
        locationId,
        userId,
        pinHash: input.pin === undefined ? null : hashSecret(input.pin),
        isActive: input.is_active ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [tenantUserLocations.tenantId, tenantUserLocations.locationId, tenantUserLocations.userId],
        set: {
          pinHash: input.pin === undefined ? sql`${tenantUserLocations.pinHash}` : hashSecret(input.pin),
          isActive: input.is_active ? 1 : 0,
          updatedAt: now,
        },
      });
  });

  const result = await requireLocationUser(tenantId, locationId, userId);
  triggerLocalMasterBootstrapRefresh(tenantId, locationId);
  await sendAccountSetupLink({
    userId,
    email: result.email,
    displayName: result.display_name,
    kind: "location_user",
    tenantId,
    locationId,
  });
  return result;
}

export async function updateLocationUser(
  tenantId: string,
  locationId: string,
  userId: string,
  request: TenantLocationUserUpdateRequest
): Promise<TenantLocationUser> {
  const current = await requireLocationUserRows(tenantId, locationId, userId);
  const input = normalizeUserInput({
    email: request.email ?? current.user.email,
    display_name: request.display_name ?? current.user.name,
    role: request.role ?? (current.tenantUser.role as TenantUserRole),
    password: request.password,
    pin: request.pin,
    status: request.status ?? current.user.status,
    is_active: request.is_active ?? current.locationUser.isActive === 1,
  }, false);
  const now = new Date();
  const passwordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;

  await getDrizzleDatabase().transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        email: input.email,
        name: input.display_name,
        role: "user",
        status: input.status,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    await tx
      .update(tenantUsers)
      .set({ role: input.role, updatedAt: now })
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, userId)));

    await tx
      .update(tenantUserLocations)
      .set({
        pinHash: input.pin === undefined ? current.locationUser.pinHash : hashSecret(input.pin),
        isActive: input.is_active ? 1 : 0,
        updatedAt: now,
      })
      .where(and(
        eq(tenantUserLocations.tenantId, tenantId),
        eq(tenantUserLocations.locationId, locationId),
        eq(tenantUserLocations.userId, userId)
      ));

    if (passwordHash !== undefined) {
      await upsertCredentialPassword(tx, userId, passwordHash, now);
    }
  });

  const result = await requireLocationUser(tenantId, locationId, userId);
  triggerLocalMasterBootstrapRefresh(tenantId, locationId);
  return result;
}

export async function resetLocationUserPassword(
  tenantId: string,
  locationId: string,
  userId: string,
  request: TenantLocationUserResetPasswordRequest = {}
): Promise<TenantLocationUserResetPasswordResponse> {
  const current = await requireLocationUserRows(tenantId, locationId, userId);
  const shouldSendEmail = request.send_email !== false;
  const now = new Date();

  if (request.password) {
    const password = normalizeResetPassword(request.password);
    await getDrizzleDatabase().transaction(async (tx) => {
      await upsertCredentialPassword(tx, userId, await hashPassword(password), now);
      await tx.update(users).set({ updatedAt: now }).where(eq(users.id, userId));
    });
  } else {
    await getDrizzleDatabase().update(users).set({ updatedAt: now }).where(eq(users.id, userId));
  }

  const user = await requireLocationUser(tenantId, locationId, userId);
  triggerLocalMasterBootstrapRefresh(tenantId, locationId);

  if (shouldSendEmail) {
    await sendAccountSetupLink({
      userId,
      email: current.user.email,
      displayName: current.user.name,
      kind: "location_user",
      tenantId,
      locationId,
    });
  }

  return {
    user,
    email_sent: shouldSendEmail,
  };
}

export async function resetLocationUserPin(
  tenantId: string,
  locationId: string,
  userId: string,
  request: TenantLocationUserResetPinRequest = {}
): Promise<TenantLocationUserResetPinResponse> {
  await requireLocationUserRows(tenantId, locationId, userId);
  const explicitPin = normalizeOptionalSecret(request.pin);
  const pin = explicitPin ?? generatePin();

  if (!/^\d{4,8}$/.test(pin)) {
    throw new ApiError("PIN must contain 4 to 8 digits.");
  }

  await getDrizzleDatabase()
    .update(tenantUserLocations)
    .set({ pinHash: hashSecret(pin), updatedAt: new Date() })
    .where(and(
      eq(tenantUserLocations.tenantId, tenantId),
      eq(tenantUserLocations.locationId, locationId),
      eq(tenantUserLocations.userId, userId)
    ));

  const user = await requireLocationUser(tenantId, locationId, userId);
  triggerLocalMasterBootstrapRefresh(tenantId, locationId);

  return {
    user,
    generated_pin: explicitPin === undefined ? pin : undefined,
  };
}

export async function archiveLocationUser(
  tenantId: string,
  locationId: string,
  userId: string
): Promise<TenantLocationUser> {
  await requireLocationUserRows(tenantId, locationId, userId);
  const now = new Date();

  await getDrizzleDatabase().transaction(async (tx) => {
    await tx
      .update(users)
      .set({ status: "DISABLED", updatedAt: now })
      .where(eq(users.id, userId));

    await tx
      .update(tenantUserLocations)
      .set({ isActive: 0, updatedAt: now })
      .where(and(
        eq(tenantUserLocations.tenantId, tenantId),
        eq(tenantUserLocations.locationId, locationId),
        eq(tenantUserLocations.userId, userId)
      ));
  });

  const user = await requireLocationUser(tenantId, locationId, userId);
  triggerLocalMasterBootstrapRefresh(tenantId, locationId);
  return user;
}

export async function deleteLocationUser(
  tenantId: string,
  locationId: string,
  userId: string
): Promise<void> {
  await requireLocationUserRows(tenantId, locationId, userId);

  await getDrizzleDatabase().transaction(async (tx) => {
    await tx
      .delete(tenantUserLocations)
      .where(and(
        eq(tenantUserLocations.tenantId, tenantId),
        eq(tenantUserLocations.locationId, locationId),
        eq(tenantUserLocations.userId, userId)
      ));

    const remainingTenantLocations = await tx
      .select({ locationId: tenantUserLocations.locationId })
      .from(tenantUserLocations)
      .where(and(eq(tenantUserLocations.tenantId, tenantId), eq(tenantUserLocations.userId, userId)))
      .limit(1);

    if (remainingTenantLocations.length === 0) {
      await tx
        .delete(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, userId)));
    }

    const remainingTenantMemberships = await tx
      .select({ tenantId: tenantUsers.tenantId })
      .from(tenantUsers)
      .where(eq(tenantUsers.userId, userId))
      .limit(1);

    if (remainingTenantMemberships.length === 0) {
      await tx
        .delete(verifications)
        .where(sql`${verifications.identifier} like ${"account_setup:%"} and ${verifications.value}::jsonb -> 'payload' ->> 'user_id' = ${userId}`);
      await tx.delete(users).where(eq(users.id, userId));
    }
  });

  triggerLocalMasterBootstrapRefresh(tenantId, locationId);
}

export async function listOwnerLocationUsers(headers: IncomingHttpHeaders, locationId: string): Promise<TenantLocationUser[]> {
  const session = await requireOwnerUserSession(headers, locationId);
  return listLocationUsers(session.tenant_id, locationId);
}

export async function createOwnerLocationUser(
  headers: IncomingHttpHeaders,
  locationId: string,
  request: TenantLocationUserCreateRequest
): Promise<TenantLocationUser> {
  const session = await requireOwnerUserSession(headers, locationId);
  return createLocationUser(session.tenant_id, locationId, request);
}

export async function updateOwnerLocationUser(
  headers: IncomingHttpHeaders,
  locationId: string,
  userId: string,
  request: TenantLocationUserUpdateRequest
): Promise<TenantLocationUser> {
  const session = await requireOwnerUserSession(headers, locationId);
  return updateLocationUser(session.tenant_id, locationId, userId, request);
}

export async function resetOwnerLocationUserPassword(
  headers: IncomingHttpHeaders,
  locationId: string,
  userId: string,
  request: TenantLocationUserResetPasswordRequest = {}
): Promise<TenantLocationUserResetPasswordResponse> {
  const session = await requireOwnerUserSession(headers, locationId);
  return resetLocationUserPassword(session.tenant_id, locationId, userId, request);
}

export async function resetOwnerLocationUserPin(
  headers: IncomingHttpHeaders,
  locationId: string,
  userId: string,
  request: TenantLocationUserResetPinRequest = {}
): Promise<TenantLocationUserResetPinResponse> {
  const session = await requireOwnerUserSession(headers, locationId);
  return resetLocationUserPin(session.tenant_id, locationId, userId, request);
}

export async function archiveOwnerLocationUser(
  headers: IncomingHttpHeaders,
  locationId: string,
  userId: string
): Promise<TenantLocationUser> {
  const session = await requireOwnerUserSession(headers, locationId);
  return archiveLocationUser(session.tenant_id, locationId, userId);
}

export async function deleteOwnerLocationUser(
  headers: IncomingHttpHeaders,
  locationId: string,
  userId: string
): Promise<void> {
  const session = await requireOwnerUserSession(headers, locationId);
  return deleteLocationUser(session.tenant_id, locationId, userId);
}

export async function listBootstrapUsers(tenantId: string, locationId: string) {
  const rows = await getLocationUserRows(tenantId, locationId);

  return rows.map(({ user, tenantUser, locationUser }) => ({
    user_id: user.id,
    email: user.email,
    display_name: user.name,
    role: tenantUser.role as TenantUserRole,
    status: user.status as "ACTIVE" | "INVITED" | "DISABLED",
    pin_hash: locationUser.pinHash,
    is_active: locationUser.isActive === 1,
  }));
}

async function requireLocationUser(tenantId: string, locationId: string, userId: string) {
  const rows = await getLocationUserRows(tenantId, locationId, userId);
  const row = rows[0];

  if (!row) {
    throw new ApiError("User not found for location.", 404);
  }

  return toTenantLocationUser(tenantId, locationId, row.user, row.tenantUser, row.locationUser, row.hasPassword);
}

async function requireLocationUserRows(tenantId: string, locationId: string, userId: string) {
  const rows = await getLocationUserRows(tenantId, locationId, userId);
  const row = rows[0];

  if (!row) {
    throw new ApiError("User not found for location.", 404);
  }

  return row;
}

async function getLocationUserRows(tenantId: string, locationId: string, userId?: string) {
  const db = getDrizzleDatabase();
  const locationRows = await db
    .select()
    .from(tenantUserLocations)
    .where(and(
      eq(tenantUserLocations.tenantId, tenantId),
      eq(tenantUserLocations.locationId, locationId),
      userId ? eq(tenantUserLocations.userId, userId) : sql`true`
    ));

  const result: LocationUserRow[] = [];

  for (const locationUser of locationRows) {
    const user = (await db.select().from(users).where(eq(users.id, locationUser.userId)).limit(1))[0];
    const tenantUser = (await db
      .select()
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, locationUser.userId)))
      .limit(1))[0];
    const credentialAccount = (await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, locationUser.userId), eq(accounts.providerId, "credential")))
      .limit(1))[0];

    if (user && tenantUser) {
      result.push({ user, tenantUser, locationUser, hasPassword: Boolean(credentialAccount) });
    }
  }

  return result;
}

async function requireLocation(tenantId: string, locationId: string) {
  const tenant = await getDrizzleDatabase().select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant[0]) throw new ApiError("Tenant not found.", 404);

  const location = await getDrizzleDatabase()
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId)))
    .limit(1);
  if (!location[0]) throw new ApiError("Location not found.", 404);
}

function normalizeUserInput(request: TenantLocationUserCreateRequest, _isCreate: boolean) {
  const email = request.email?.trim().toLowerCase() ?? "";
  const displayName = request.display_name?.trim() ?? "";
  const role = request.role;
  const status = request.status ?? "ACTIVE";
  const password = normalizeOptionalSecret(request.password);
  const pin = normalizeOptionalSecret(request.pin);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError("A valid email is required.");
  }

  if (!displayName) {
    throw new ApiError("Display name is required.");
  }

  if (!allowedRoles.includes(role)) {
    throw new ApiError("User role is invalid.");
  }

  if (status !== "ACTIVE" && status !== "INVITED" && status !== "DISABLED") {
    throw new ApiError("User status is invalid.");
  }

  if (password !== undefined && password.length < 8) {
    throw new ApiError("Password must contain at least 8 characters.");
  }

  if (pin !== undefined && !/^\d{4,8}$/.test(pin)) {
    throw new ApiError("PIN must contain 4 to 8 digits.");
  }

  return {
    email,
    display_name: displayName,
    role,
    password,
    pin,
    status,
    is_active: request.is_active ?? true,
  };
}

function normalizeOptionalSecret(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeResetPassword(value: string | null | undefined) {
  const password = normalizeOptionalSecret(value) ?? generateTemporaryPassword();

  if (password.length < 8) {
    throw new ApiError("Password must contain at least 8 characters.");
  }

  return password;
}

function generateTemporaryPassword() {
  return randomBytes(18).toString("base64url");
}

function generatePin() {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

async function requireOwnerUserSession(headers: IncomingHttpHeaders, locationId: string) {
  const session = await requireStaffSession(headers, locationId);

  if (session.role !== "OWNER" && session.role !== "MANAGER") {
    throw new ApiError("Owner or manager role is required.", 403);
  }

  return session;
}

function hashSecret(secret: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(secret, salt, 120_000, 32, "sha256").toString("hex");
  return "pbkdf2_sha256$120000$" + salt + "$" + hash;
}

async function upsertCredentialPassword(
  tx: ReturnType<typeof getDrizzleDatabase>,
  userId: string,
  passwordHash: string,
  now: Date
) {
  const existingAccount = (await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .limit(1))[0];

  if (existingAccount) {
    await tx
      .update(accounts)
      .set({ password: passwordHash, updatedAt: now })
      .where(eq(accounts.id, existingAccount.id));
    return;
  }

  await tx.insert(accounts).values({
    id: randomBytes(16).toString("hex"),
    accountId: userId,
    providerId: "credential",
    userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
}

function toTenantLocationUser(
  tenantId: string,
  locationId: string,
  user: UserRow,
  tenantUser: TenantUserRow,
  locationUser: TenantUserLocationRow,
  hasPassword: boolean
): TenantLocationUser {
  return {
    user_id: user.id,
    tenant_id: tenantId,
    location_id: locationId,
    email: user.email,
    display_name: user.name,
    role: tenantUser.role as TenantUserRole,
    status: user.status,
    has_password: hasPassword,
    has_pin: Boolean(locationUser.pinHash),
    is_active: locationUser.isActive === 1,
    created_at: locationUser.createdAt.toISOString(),
    updated_at: locationUser.updatedAt.toISOString(),
  };
}
