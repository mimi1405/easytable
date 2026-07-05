import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import { locations, tenantUserLocations, tenantUsers, tenants, users } from "../db/schema.js";
import type {
  TenantLocationUser,
  TenantLocationUserCreateRequest,
  TenantLocationUserUpdateRequest,
  TenantUserRole
} from "../types.js";
import { ApiError } from "./errors.js";

type UserRow = typeof users.$inferSelect;
type TenantUserRow = typeof tenantUsers.$inferSelect;
type TenantUserLocationRow = typeof tenantUserLocations.$inferSelect;

const allowedRoles: TenantUserRole[] = ["OWNER", "MANAGER", "STAFF", "KDS", "POS_OPERATOR"];

export async function listLocationUsers(tenantId: string, locationId: string): Promise<TenantLocationUser[]> {
  await requireLocation(tenantId, locationId);
  const rows = await getLocationUserRows(tenantId, locationId);

  return rows.map(({ user, tenantUser, locationUser }) => toTenantLocationUser(tenantId, locationId, user, tenantUser, locationUser));
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
  const existingUsers = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${input.email})`)
    .limit(1);
  const userId = existingUsers[0]?.id ?? "user_" + randomUUID();

  await db.transaction(async (tx) => {
    if (existingUsers[0]) {
      await tx
        .update(users)
        .set({
          displayName: input.display_name,
          passwordHash: input.password === undefined ? existingUsers[0].passwordHash : hashSecret(input.password),
          status: input.status,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
    } else {
      await tx
        .insert(users)
        .values({
          id: userId,
          email: input.email,
          displayName: input.display_name,
          passwordHash: input.password === undefined ? null : hashSecret(input.password),
          status: input.status,
          createdAt: now,
          updatedAt: now,
        });
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

  return requireLocationUser(tenantId, locationId, userId);
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
    display_name: request.display_name ?? current.user.displayName,
    role: request.role ?? (current.tenantUser.role as TenantUserRole),
    password: request.password,
    pin: request.pin,
    status: request.status ?? current.user.status,
    is_active: request.is_active ?? current.locationUser.isActive === 1,
  }, false);
  const now = new Date();

  await getDrizzleDatabase().transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        email: input.email,
        displayName: input.display_name,
        passwordHash: input.password === undefined ? current.user.passwordHash : hashSecret(input.password),
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
  });

  return requireLocationUser(tenantId, locationId, userId);
}

export async function listBootstrapUsers(tenantId: string, locationId: string) {
  const rows = await getLocationUserRows(tenantId, locationId);

  return rows.map(({ user, tenantUser, locationUser }) => ({
    user_id: user.id,
    email: user.email,
    display_name: user.displayName,
    role: tenantUser.role as TenantUserRole,
    status: user.status as "ACTIVE" | "INVITED" | "DISABLED",
    pin_hash: locationUser.pinHash,
    is_active: locationUser.isActive === 1,
  }));
}

export async function authenticateLocationUserByPin(tenantId: string, locationId: string, email: string, pin: string) {
  await requireLocation(tenantId, locationId);
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPin = pin.trim();
  const rows = await getLocationUserRows(tenantId, locationId);
  const row = rows.find(({ user }) => user.email.toLowerCase() === normalizedEmail);

  if (!row || row.user.status !== "ACTIVE" || row.locationUser.isActive !== 1) {
    throw new ApiError("Invalid staff credentials.", 401);
  }

  const role = row.tenantUser.role as TenantUserRole;
  if (role !== "STAFF" && role !== "MANAGER" && role !== "OWNER") {
    throw new ApiError("User is not allowed to use Staff relay.", 403);
  }

  if (!row.locationUser.pinHash || !verifySecret(normalizedPin, row.locationUser.pinHash)) {
    throw new ApiError("Invalid staff credentials.", 401);
  }

  return {
    user_id: row.user.id,
    tenant_id: tenantId,
    location_id: locationId,
    email: row.user.email,
    display_name: row.user.displayName,
    role,
  };
}

async function requireLocationUser(tenantId: string, locationId: string, userId: string) {
  const rows = await getLocationUserRows(tenantId, locationId, userId);
  const row = rows[0];

  if (!row) {
    throw new ApiError("User not found for location.", 404);
  }

  return toTenantLocationUser(tenantId, locationId, row.user, row.tenantUser, row.locationUser);
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

  const result: Array<{ user: UserRow; tenantUser: TenantUserRow; locationUser: TenantUserLocationRow }> = [];

  for (const locationUser of locationRows) {
    const user = (await db.select().from(users).where(eq(users.id, locationUser.userId)).limit(1))[0];
    const tenantUser = (await db
      .select()
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, locationUser.userId)))
      .limit(1))[0];

    if (user && tenantUser) {
      result.push({ user, tenantUser, locationUser });
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

function normalizeUserInput(request: TenantLocationUserCreateRequest, isCreate: boolean) {
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

  if (isCreate && request.password === undefined) {
    throw new ApiError("Initial password is required.");
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

function hashSecret(secret: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(secret, salt, 120_000, 32, "sha256").toString("hex");
  return "pbkdf2_sha256$120000$" + salt + "$" + hash;
}

function verifySecret(secret: string, storedHash: string) {
  const [algorithm, iterationsValue, salt, expectedHash] = storedHash.split("$");
  const iterations = Number(iterationsValue);

  if (algorithm !== "pbkdf2_sha256" || !Number.isInteger(iterations) || !salt || !expectedHash) {
    return false;
  }

  const actual = pbkdf2Sync(secret, salt, iterations, 32, "sha256");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function toTenantLocationUser(
  tenantId: string,
  locationId: string,
  user: UserRow,
  tenantUser: TenantUserRow,
  locationUser: TenantUserLocationRow
): TenantLocationUser {
  return {
    user_id: user.id,
    tenant_id: tenantId,
    location_id: locationId,
    email: user.email,
    display_name: user.displayName,
    role: tenantUser.role as TenantUserRole,
    status: user.status,
    has_password: Boolean(user.passwordHash),
    has_pin: Boolean(locationUser.pinHash),
    is_active: locationUser.isActive === 1,
    created_at: locationUser.createdAt.toISOString(),
    updated_at: locationUser.updatedAt.toISOString(),
  };
}
