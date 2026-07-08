import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import { accounts, tenantUserLocations, users, verifications } from "../db/schema.js";
import type {
  AccountSetupCompleteRequest,
  AccountSetupCompleteResponse,
  AccountSetupContext
} from "../types.js";
import { sendAccountSetupEmail } from "../services/email/resend.js";
import { triggerLocalMasterBootstrapRefresh } from "./adminSync.js";
import { ApiError } from "./errors.js";

type AccountSetupKind = AccountSetupContext["kind"];

type AccountSetupTokenPayload = {
  type: "account_setup";
  user_id: string;
  email: string;
  display_name: string;
  kind: AccountSetupKind;
  tenant_id: string | null;
  location_id: string | null;
  created_at: string;
};

type CreateAccountSetupInput = {
  userId: string;
  email: string;
  displayName: string;
  kind: AccountSetupKind;
  tenantId?: string | null;
  locationId?: string | null;
};

const accountSetupPrefix = "account_setup:";
const accountSetupTtlMs = 1000 * 60 * 60 * 24 * 3;

export async function sendAccountSetupLink(input: CreateAccountSetupInput) {
  requireAccountSetupEmailConfig();
  const token = await createAccountSetupToken(input);
  const setupUrl = createAccountSetupUrl(token, input.kind);

  await sendAccountSetupEmail({
    to: input.email,
    displayName: input.displayName,
    setupUrl,
    requiresPin: input.kind === "location_user",
  });
}

export async function getAccountSetupContext(token: string): Promise<AccountSetupContext> {
  const { payload } = await requireAccountSetupToken(token);
  const user = await requireUser(payload.user_id);

  return {
    email: user.email,
    display_name: user.name,
    kind: payload.kind,
    requires_pin: payload.kind === "location_user",
    tenant_id: payload.tenant_id,
    location_id: payload.location_id,
  };
}

export async function completeAccountSetup(
  token: string,
  request: AccountSetupCompleteRequest
): Promise<AccountSetupCompleteResponse> {
  const password = normalizeSetupPassword(request.password);
  const { row, payload } = await requireAccountSetupToken(token);
  const now = new Date();
  const passwordHash = await hashPassword(password);
  const pin = payload.kind === "location_user" ? normalizeSetupPin(request.pin) : null;

  await getDrizzleDatabase().transaction(async (tx) => {
    await tx.delete(verifications).where(eq(verifications.id, row.id));

    await upsertCredentialPassword(tx, payload.user_id, passwordHash, now);
    await tx.update(users).set({ status: "ACTIVE", updatedAt: now }).where(eq(users.id, payload.user_id));

    if (payload.kind === "location_user") {
      if (!payload.tenant_id || !payload.location_id || !pin) {
        throw new ApiError("Account setup PIN context is invalid.", 400);
      }

      const relation = (await tx
        .select({ userId: tenantUserLocations.userId })
        .from(tenantUserLocations)
        .where(and(
          eq(tenantUserLocations.tenantId, payload.tenant_id),
          eq(tenantUserLocations.locationId, payload.location_id),
          eq(tenantUserLocations.userId, payload.user_id)
        ))
        .limit(1))[0];

      if (!relation) {
        throw new ApiError("Account setup location relation was not found.", 404);
      }

      await tx
        .update(tenantUserLocations)
        .set({ pinHash: hashSecret(pin), isActive: 1, updatedAt: now })
        .where(and(
          eq(tenantUserLocations.tenantId, payload.tenant_id),
          eq(tenantUserLocations.locationId, payload.location_id),
          eq(tenantUserLocations.userId, payload.user_id)
        ));
    }
  });

  if (payload.kind === "location_user" && payload.tenant_id && payload.location_id) {
    triggerLocalMasterBootstrapRefresh(payload.tenant_id, payload.location_id);
  }

  return { ok: true, kind: payload.kind };
}

async function createAccountSetupToken(input: CreateAccountSetupInput) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = new Date();
  const payload: AccountSetupTokenPayload = {
    type: "account_setup",
    user_id: input.userId,
    email: input.email,
    display_name: input.displayName,
    kind: input.kind,
    tenant_id: input.tenantId ?? null,
    location_id: input.locationId ?? null,
    created_at: now.toISOString(),
  };

  await getDrizzleDatabase()
    .delete(verifications)
    .where(sql`${verifications.identifier} like ${accountSetupPrefix + "%"} and ${verifications.value}::jsonb -> 'payload' ->> 'user_id' = ${input.userId}`);

  await getDrizzleDatabase().insert(verifications).values({
    id: randomBytes(16).toString("hex"),
    identifier: accountSetupPrefix + tokenHash,
    value: JSON.stringify({ payload }),
    expiresAt: new Date(now.getTime() + accountSetupTtlMs),
    createdAt: now,
    updatedAt: now,
  });

  return token;
}

async function requireAccountSetupToken(token: string) {
  const tokenHash = hashToken(token);
  const row = (await getDrizzleDatabase()
    .select()
    .from(verifications)
    .where(eq(verifications.identifier, accountSetupPrefix + tokenHash))
    .limit(1))[0];

  if (!row) {
    throw new ApiError("Account setup link is invalid or has already been used.", 404);
  }

  if (row.expiresAt <= new Date()) {
    await getDrizzleDatabase().delete(verifications).where(eq(verifications.id, row.id));
    throw new ApiError("Account setup link has expired.", 410);
  }

  const parsed = parseStoredToken(row.value);
  if (!parsed) {
    throw new ApiError("Account setup link is invalid.", 404);
  }

  return { row, payload: parsed.payload };
}

async function requireUser(userId: string) {
  const user = (await getDrizzleDatabase().select().from(users).where(eq(users.id, userId)).limit(1))[0];

  if (!user) {
    throw new ApiError("Account setup user was not found.", 404);
  }

  return user;
}

function parseStoredToken(value: string | null): { payload: AccountSetupTokenPayload } | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as { payload?: unknown };
    const payload = parsed.payload as AccountSetupTokenPayload | undefined;

    if (
      payload?.type === "account_setup" &&
      typeof payload.user_id === "string" &&
      (payload.kind === "platform_admin" || payload.kind === "location_user")
    ) {
      return { payload };
    }
  } catch {
    return null;
  }

  return null;
}

function createAccountSetupUrl(token: string, kind: AccountSetupKind) {
  const baseUrl = (
    (kind === "platform_admin" ? process.env.PLATFORM_ADMIN_SETUP_PUBLIC_BASE_URL : process.env.STAFF_SETUP_PUBLIC_BASE_URL) ||
    process.env.ACCOUNT_SETUP_PUBLIC_BASE_URL ||
    process.env.RELAY_PUBLIC_BASE_URL ||
    (kind === "platform_admin" ? "http://localhost:1424" : "http://localhost:1423")
  ).replace(/\/$/, "");
  return baseUrl + "/account-setup?token=" + encodeURIComponent(token);
}

function requireAccountSetupEmailConfig() {
  if (!process.env.RESEND_API_KEY?.trim()) {
    throw new ApiError("RESEND_API_KEY is required to send account setup emails.", 500);
  }

  if (!process.env.RESEND_FROM_EMAIL?.trim()) {
    throw new ApiError("RESEND_FROM_EMAIL is required to send account setup emails.", 500);
  }
}

function normalizeSetupPassword(value: string | null | undefined) {
  const password = value?.trim() ?? "";

  if (password.length < 8) {
    throw new ApiError("Password must contain at least 8 characters.");
  }

  return password;
}

function normalizeSetupPin(value: string | null | undefined) {
  const pin = value?.trim() ?? "";

  if (!/^\d{4,8}$/.test(pin)) {
    throw new ApiError("PIN must contain 4 to 8 digits.");
  }

  return pin;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
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
    await tx.update(accounts).set({ password: passwordHash, updatedAt: now }).where(eq(accounts.id, existingAccount.id));
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
