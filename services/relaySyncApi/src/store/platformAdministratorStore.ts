import { randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";

import { auth } from "../auth.js";
import { getDrizzleDatabase } from "../db/client.js";
import { accounts, tenantUsers, users, verifications } from "../db/schema.js";
import type {
  PlatformAdministrator,
  PlatformAdministratorCreateRequest,
  PlatformAdministratorCreateResponse,
  PlatformAdministratorResetPasswordResponse,
  PlatformAdministratorUpdateRequest,
  UserStatus
} from "../types.js";
import { sendAccountSetupLink } from "./accountSetupStore.js";
import { ApiError } from "./errors.js";

type UserRow = typeof users.$inferSelect;

export async function listPlatformAdministrators(): Promise<PlatformAdministrator[]> {
  const rows = await getDrizzleDatabase()
    .select()
    .from(users)
    .where(and(
      eq(users.role, "platform_admin"),
      sql`not exists (select 1 from ${tenantUsers} where ${tenantUsers.userId} = ${users.id})`
    ))
    .orderBy(users.email);

  return rows.map(toPlatformAdministrator);
}

export async function createPlatformAdministrator(
  request: PlatformAdministratorCreateRequest
): Promise<PlatformAdministratorCreateResponse> {
  const input = normalizePlatformAdministratorInput(request, true);
  const internalPassword = generateTemporaryPassword();
  const now = new Date();
  const db = getDrizzleDatabase();
  const existing = await findUserByEmail(input.email);

  if (!existing) {
    await auth.api.signUpEmail({
      body: {
        email: input.email,
        password: internalPassword,
        name: input.display_name,
      },
    });
  }

  const user = await findUserByEmail(input.email);

  if (!user) {
    throw new ApiError("Better Auth user could not be created.", 500);
  }

  if (existing) {
    if (existing.role !== "platform_admin") {
      throw new ApiError("A non-platform user with this email already exists.", 409);
    }

    await requireNoTenantMembership(existing.id);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        email: input.email,
        name: input.display_name,
        role: "platform_admin",
        status: input.status,
        emailVerified: true,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));

    await upsertCredentialPassword(tx, user.id, await hashPassword(internalPassword), now);
  });

  await sendAccountSetupLink({
    userId: user.id,
    email: input.email,
    displayName: input.display_name,
    kind: "platform_admin",
  });

  return {
    user: toPlatformAdministrator({ ...user, email: input.email, name: input.display_name, role: "platform_admin", status: input.status, updatedAt: now }),
    email_sent: true,
  };
}

export async function updatePlatformAdministrator(
  userId: string,
  request: PlatformAdministratorUpdateRequest
): Promise<PlatformAdministrator> {
  const current = await requirePlatformAdministrator(userId);
  const input = normalizePlatformAdministratorInput({
    email: current.email,
    display_name: request.display_name ?? current.display_name,
    status: request.status ?? current.status,
  }, false);
  const now = new Date();

  await getDrizzleDatabase()
    .update(users)
    .set({
      name: input.display_name,
      status: input.status,
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  return toPlatformAdministrator({ ...current.__row, name: input.display_name, status: input.status, updatedAt: now });
}

export async function resetPlatformAdministratorPassword(
  userId: string
): Promise<PlatformAdministratorResetPasswordResponse> {
  const current = await requirePlatformAdministrator(userId);
  const now = new Date();

  await getDrizzleDatabase().update(users).set({ updatedAt: now }).where(eq(users.id, userId));

  await sendAccountSetupLink({
    userId,
    email: current.email,
    displayName: current.display_name,
    kind: "platform_admin",
  });

  return {
    user: toPlatformAdministrator({ ...current.__row, updatedAt: now }),
    email_sent: true,
  };
}

export async function archivePlatformAdministrator(userId: string): Promise<PlatformAdministrator> {
  const current = await requirePlatformAdministrator(userId);
  const now = new Date();

  await getDrizzleDatabase()
    .update(users)
    .set({ status: "DISABLED", updatedAt: now })
    .where(eq(users.id, userId));

  return toPlatformAdministrator({ ...current.__row, status: "DISABLED", updatedAt: now });
}

export async function deletePlatformAdministrator(userId: string): Promise<void> {
  await requirePlatformAdministrator(userId);

  await getDrizzleDatabase().transaction(async (tx) => {
    await tx
      .delete(verifications)
      .where(sql`${verifications.identifier} like ${"account_setup:%"} and ${verifications.value}::jsonb -> 'payload' ->> 'user_id' = ${userId}`);
    await tx.delete(users).where(eq(users.id, userId));
  });
}

async function findUserByEmail(email: string) {
  return (await getDrizzleDatabase()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1))[0] ?? null;
}

async function requirePlatformAdministrator(userId: string) {
  const row = (await getDrizzleDatabase()
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "platform_admin")))
    .limit(1))[0];

  if (!row) {
    throw new ApiError("Platform administrator not found.", 404);
  }

  await requireNoTenantMembership(row.id);

  return {
    ...toPlatformAdministrator(row),
    __row: row,
  };
}

async function requireNoTenantMembership(userId: string) {
  const membership = (await getDrizzleDatabase()
    .select({ tenantId: tenantUsers.tenantId })
    .from(tenantUsers)
    .where(eq(tenantUsers.userId, userId))
    .limit(1))[0];

  if (membership) {
    throw new ApiError("Tenant users cannot be managed as platform administrators.", 409);
  }
}

function normalizePlatformAdministratorInput(request: PlatformAdministratorCreateRequest, isCreate: boolean) {
  const email = request.email?.trim().toLowerCase() ?? "";
  const displayName = request.display_name?.trim() ?? "";
  const status = request.status ?? "ACTIVE";

  if (isCreate && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError("A valid email is required.");
  }

  if (!displayName) {
    throw new ApiError("Display name is required.");
  }

  if (!isUserStatus(status)) {
    throw new ApiError("User status is invalid.");
  }

  return {
    email,
    display_name: displayName,
    status,
  };
}

function isUserStatus(value: unknown): value is UserStatus {
  return value === "ACTIVE" || value === "INVITED" || value === "DISABLED";
}

function generateTemporaryPassword() {
  return randomBytes(18).toString("base64url");
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

function toPlatformAdministrator(user: UserRow): PlatformAdministrator {
  return {
    user_id: user.id,
    email: user.email,
    display_name: user.name,
    status: user.status,
    role: "platform_admin",
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}
