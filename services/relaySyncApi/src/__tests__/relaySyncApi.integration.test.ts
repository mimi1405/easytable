import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import Fastify from "fastify";

const testDatabaseUrl = process.env.RELAY_SYNC_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const hasDatabase = Boolean(testDatabaseUrl);
const createdTenantIds = new Set<string>();
const createdPlatformAdminEmails = new Set<string>();

let modules: Awaited<ReturnType<typeof loadModules>> | null = null;

before(async () => {
  if (!hasDatabase) {
    return;
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.RELAY_COMMAND_REDELIVERY_TIMEOUT_MS = "5000";
  process.env.ADMIN_SYNC_DEBOUNCE_MS = "5";
  modules = await loadModules();
  installNatsTestDouble(modules);
  await modules.initializeDatabase();
});

beforeEach(() => {
  if (modules) {
    installNatsTestDouble(modules);
  }
});

afterEach(async () => {
  if (modules) {
    await cleanupCreatedTenants(modules);
    await modules.resetNatsForTest();
  }
});

after(async () => {
  if (modules) {
    await modules.resetNatsForTest();
    await modules.closeDatabase();
  }
});

test("pairing creates a scoped credential and relay commands ACK through the lifecycle", { skip: !hasDatabase }, async () => {
  const ctx = assertModules();
  const seed = await seedTenantLocation(ctx);
  const session = await ctx.createLocalMasterPairingSession(seed.tenantId, seed.locationId);
  const pairing = await ctx.pairLocalMaster({
    setup_code: session.setup_code ?? "",
    instance_id: "lm_" + seed.suffix,
    local_master_url: "http://192.168.1.20:3000",
    version: "test"
  });

  assert.equal(pairing.tenant_id, seed.tenantId);
  assert.equal(pairing.location_id, seed.locationId);
  assert.equal(pairing.local_master_instance_id, "lm_" + seed.suffix);
  assert.match(pairing.relay_token, /^lmrt_/);

  const credential = await ctx.requireLocalMasterCredential(pairing.relay_token);
  assert.equal(credential.tenantId, seed.tenantId);
  assert.equal(credential.locationId, seed.locationId);
  assert.equal(credential.localMasterInstanceId, pairing.local_master_instance_id);
  assert.notEqual(credential.tokenDigest, pairing.relay_token);

  await ctx.db.insert(ctx.schema.relayCommands).values({
    id: "cmd_" + seed.suffix,
    tenantId: seed.tenantId,
    locationId: seed.locationId,
    localMasterInstanceId: pairing.local_master_instance_id,
    type: "STAFF_ORDER_SNAPSHOT_CREATE",
    status: "pending",
    payloadJson: { request_id: "request_" + seed.suffix },
    resultJson: null,
    deliveredAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const delivered = await ctx.listPendingRelayCommands(pairing.relay_token);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.status, "delivered");

  const accepted = await ctx.ackRelayCommand(pairing.relay_token, delivered[0]?.command_id ?? "", {
    status: "accepted",
    result: { entity: { ok: true } }
  });
  assert.equal(accepted.status, "accepted");
  assert.deepEqual(accepted.result, { ok: true });
});

test("delivered relay commands are redelivered after timeout but not to another LocalMaster", { skip: !hasDatabase }, async () => {
  const ctx = assertModules();
  const seed = await seedTenantLocation(ctx);
  const firstPairingSession = await ctx.createLocalMasterPairingSession(seed.tenantId, seed.locationId);
  const firstPairing = await ctx.pairLocalMaster({
    setup_code: firstPairingSession.setup_code ?? "",
    instance_id: "lm_redeliver_" + seed.suffix
  });
  const oldDeliveredAt = new Date(Date.now() - 60_000);

  await ctx.db.insert(ctx.schema.relayCommands).values({
    id: "cmd_redeliver_" + seed.suffix,
    tenantId: seed.tenantId,
    locationId: seed.locationId,
    localMasterInstanceId: firstPairing.local_master_instance_id,
    type: "STAFF_PICKUP_ACKNOWLEDGE",
    status: "delivered",
    payloadJson: { request_id: "request_redeliver_" + seed.suffix, pickup_id: "pickup_test" },
    resultJson: null,
    deliveredAt: oldDeliveredAt,
    completedAt: null,
    createdAt: oldDeliveredAt,
    updatedAt: oldDeliveredAt
  });

  const redelivered = await ctx.listPendingRelayCommands(firstPairing.relay_token);
  assert.equal(redelivered.length, 1);
  assert.equal(redelivered[0]?.status, "delivered");

  const secondPairingSession = await ctx.createLocalMasterPairingSession(seed.tenantId, seed.locationId);
  const secondPairing = await ctx.pairLocalMaster({
    setup_code: secondPairingSession.setup_code ?? "",
    instance_id: "lm_other_" + seed.suffix
  });
  const forOtherMaster = await ctx.listPendingRelayCommands(secondPairing.relay_token);

  assert.equal(forOtherMaster.length, 0);
});

test("PowerSync token and upload endpoints accept known tables and ignore unknown tables", { skip: !hasDatabase }, async () => {
  const ctx = assertModules();
  const seed = await seedTenantLocation(ctx);
  const pairingSession = await ctx.createLocalMasterPairingSession(seed.tenantId, seed.locationId);
  const pairing = await ctx.pairLocalMaster({
    setup_code: pairingSession.setup_code ?? "",
    instance_id: "lm_powersync_" + seed.suffix
  });
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "Internal server error.";
    return reply.code(statusCode).send({ error: message });
  });
  await ctx.registerPowerSyncRoutes(app);

  try {
    const tokenResponse = await app.inject({
      method: "GET",
      url: "/api/local-masters/powersync-token",
      headers: { authorization: "Bearer " + pairing.relay_token }
    });
    assert.equal(tokenResponse.statusCode, 200, tokenResponse.body);
    assert.match(tokenResponse.json<{ token: string }>().token, /^[\w-]+\.[\w-]+\.[\w-]+$/);

    const uploadResponse = await app.inject({
      method: "POST",
      url: "/api/local-masters/powersync-upload",
      headers: { authorization: "Bearer " + pairing.relay_token },
      payload: {
        client_id: "client_" + seed.suffix,
        mutations: [{
          op: "PUT",
          table: "unknown_table",
          id: "unknown_" + seed.suffix,
          row: { ignored: true }
        }, {
          op: "PATCH",
          table: "tenants",
          id: seed.tenantId,
          row: {
            name: "Tenant Synced",
            slug: "tenant-synced-" + seed.suffix,
            email: "synced@example.test",
            phone: null,
            website: null,
            status: "ACTIVE"
          }
        }]
      }
    });

    assert.equal(uploadResponse.statusCode, 200, uploadResponse.body);
    const tenant = (await ctx.db
      .select()
      .from(ctx.schema.tenants)
      .where(ctx.eq(ctx.schema.tenants.id, seed.tenantId))
      .limit(1))[0];
    assert.equal(tenant?.name, "Tenant Synced");
    assert.equal(tenant?.slug, "tenant-synced-" + seed.suffix);
  } finally {
    await app.close();
  }
});

test("location user setup link sets password and PIN and queues bootstrap refresh", { skip: !hasDatabase }, async () => {
  const ctx = assertModules();
  const seed = await seedTenantLocation(ctx);
  const pairingSession = await ctx.createLocalMasterPairingSession(seed.tenantId, seed.locationId);
  await ctx.pairLocalMaster({
    setup_code: pairingSession.setup_code ?? "",
    instance_id: "lm_users_" + seed.suffix
  });
  const sentEmails: Array<{ to: string[]; text: string }> = [];
  process.env.RESEND_API_KEY = "test_resend_key";
  process.env.RESEND_FROM_EMAIL = "EasyTable <info@example.test>";
  process.env.STAFF_SETUP_PUBLIC_BASE_URL = "http://staff.example.test";
  ctx.setResendClientFactoryForTest(() => ({
    emails: {
      async send(payload) {
        sentEmails.push({ to: payload.to, text: payload.text });
        return {};
      }
    }
  }));

  try {
    const user = await ctx.createLocationUser(seed.tenantId, seed.locationId, {
      email: "user-" + seed.suffix + "@example.test",
      display_name: "Relay User",
      role: "STAFF",
      status: "ACTIVE",
      is_active: true
    });
    await waitForBootstrapRefreshCount(ctx, seed.tenantId, seed.locationId, 1);
    const oldAccount = await readCredentialAccount(ctx, user.user_id);
    assert.equal(user.has_pin, false);
    assert.deepEqual(sentEmails[0]?.to, ["user-" + seed.suffix + "@example.test"]);
    assert.match(sentEmails[0]?.text ?? "", /Zugang/);
    assert.match(sentEmails[0]?.text ?? "", /http:\/\/staff\.example\.test\/account-setup/);

    const setupToken = extractSetupToken(sentEmails[0]?.text ?? "");
    const invalidToken = await ctx.getAccountSetupContext("invalid-token").then(
      () => "accepted",
      (error: unknown) => error instanceof Error ? error.message : String(error)
    );
    assert.match(invalidToken, /invalid|used/i);

    const context = await ctx.getAccountSetupContext(setupToken);
    assert.equal(context.email, "user-" + seed.suffix + "@example.test");
    assert.equal(context.kind, "location_user");
    assert.equal(context.requires_pin, true);

    await ctx.completeAccountSetup(setupToken, {
      password: "new-user-password",
      pin: "9876"
    });
    await waitForBootstrapRefreshCount(ctx, seed.tenantId, seed.locationId, 2);

    const newAccount = await readCredentialAccount(ctx, user.user_id);
    assert.ok(oldAccount?.password);
    assert.ok(newAccount?.password);
    assert.notEqual(newAccount.password, oldAccount.password);
    const completedUser = await ctx.listLocationUsers(seed.tenantId, seed.locationId);
    assert.equal(completedUser.find((candidate) => candidate.user_id === user.user_id)?.has_pin, true);
    const usedToken = await ctx.getAccountSetupContext(setupToken).then(
      () => "accepted",
      (error: unknown) => error instanceof Error ? error.message : String(error)
    );
    assert.match(usedToken, /invalid|used/i);

    const passwordReset = await ctx.resetLocationUserPassword(seed.tenantId, seed.locationId, user.user_id, {});
    assert.equal(passwordReset.user.has_password, true);
    assert.equal(passwordReset.email_sent, true);
    assert.equal(sentEmails.length, 2);
    await waitForBootstrapRefreshCount(ctx, seed.tenantId, seed.locationId, 3);
    const resetSetupToken = extractSetupToken(sentEmails[1]?.text ?? "");
    await ctx.completeAccountSetup(resetSetupToken, {
      password: "reset-user-password",
      pin: "6789"
    });
    await waitForBootstrapRefreshCount(ctx, seed.tenantId, seed.locationId, 4);

    const pinReset = await ctx.resetLocationUserPin(seed.tenantId, seed.locationId, user.user_id, {});
    assert.equal(pinReset.user.has_pin, true);
    assert.match(pinReset.generated_pin ?? "", /^\d{6}$/);
    await waitForBootstrapRefreshCount(ctx, seed.tenantId, seed.locationId, 5);

    await ctx.db
      .update(ctx.schema.users)
      .set({ role: "platform_admin", updatedAt: new Date() })
      .where(ctx.eq(ctx.schema.users.id, user.user_id));
    await ctx.updateLocationUser(seed.tenantId, seed.locationId, user.user_id, {
      role: "OWNER",
    });
    const tenantOwner = (await ctx.db
      .select({ globalRole: ctx.schema.users.role })
      .from(ctx.schema.users)
      .where(ctx.eq(ctx.schema.users.id, user.user_id))
      .limit(1))[0];
    assert.equal(tenantOwner?.globalRole, "user");
  } finally {
    ctx.resetResendClientFactoryForTest();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.STAFF_SETUP_PUBLIC_BASE_URL;
  }
});

test("platform administrator API requires auth and manages cloud admins", { skip: !hasDatabase }, async () => {
  const ctx = assertModules();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const email = "platform-admin-" + suffix + "@example.test";
  const nonPlatformEmail = "not-platform-admin-" + suffix + "@example.test";
  createdPlatformAdminEmails.add(email);
  createdPlatformAdminEmails.add(nonPlatformEmail);
  const sentEmails: Array<{ to: string[]; text: string }> = [];
  process.env.RESEND_API_KEY = "test_resend_key";
  process.env.RESEND_FROM_EMAIL = "EasyTable <info@example.test>";
  process.env.PLATFORM_ADMIN_SETUP_PUBLIC_BASE_URL = "http://platform.example.test";
  process.env.RELAY_ADMIN_TOKEN = "test-admin-token";
  ctx.setResendClientFactoryForTest(() => ({
    emails: {
      async send(payload) {
        sentEmails.push({ to: payload.to, text: payload.text });
        return {};
      }
    }
  }));

  const authApp = Fastify({ logger: false });
  authApp.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "Internal server error.";
    return reply.code(statusCode).send({ error: message });
  });
  await ctx.registerAuthRoutes(authApp);
  await ctx.auth.api.signUpEmail({
    body: {
      email: nonPlatformEmail,
      password: "not-platform-password",
      name: "Not Platform Admin"
    }
  });
  const signedIn = await authApp.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: {
      email: nonPlatformEmail,
      password: "not-platform-password"
    }
  });
  assert.equal(signedIn.statusCode, 200, signedIn.body);
  const nonPlatformSessionCookie = extractCookieHeader(signedIn.headers["set-cookie"]);
  await authApp.close();

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "Internal server error.";
    return reply.code(statusCode).send({ error: message });
  });
  await ctx.registerAdminRoutes(app);

  try {
    const rejected = await app.inject({
      method: "GET",
      url: "/api/admin/platform-administrators"
    });
    assert.equal(rejected.statusCode, 401, rejected.body);

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/admin/platform-administrators",
      headers: { cookie: nonPlatformSessionCookie }
    });
    assert.equal(forbidden.statusCode, 403, forbidden.body);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/platform-administrators",
      headers: { authorization: "Bearer test-admin-token" },
      payload: {
        email,
        display_name: "Platform Admin Test",
        status: "ACTIVE"
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json<{ user: { email: string; role: string }; email_sent: boolean }>().user.email, email);
    assert.equal(created.json<{ user: { email: string; role: string }; email_sent: boolean }>().user.role, "platform_admin");
    assert.equal(created.json<{ user: { email: string; role: string }; email_sent: boolean }>().email_sent, true);
    assert.deepEqual(sentEmails[0]?.to, [email]);
    assert.match(sentEmails[0]?.text ?? "", /http:\/\/platform\.example\.test\/account-setup/);
    const createSetupToken = extractSetupToken(sentEmails[0]?.text ?? "");

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/platform-administrators",
      headers: { authorization: "Bearer test-admin-token" }
    });
    assert.equal(list.statusCode, 200, list.body);
    const admin = list.json<{ data: Array<{ user_id: string; email: string }> }>().data.find((user) => user.email === email);
    assert.ok(admin);
    const createdUser = (await ctx.db
      .select({ role: ctx.schema.users.role })
      .from(ctx.schema.users)
      .where(ctx.eq(ctx.schema.users.id, admin.user_id))
      .limit(1))[0];
    assert.equal(createdUser?.role, "platform_admin");
    const tenantMemberships = await ctx.db
      .select({ role: ctx.schema.tenantUsers.role })
      .from(ctx.schema.tenantUsers)
      .where(ctx.eq(ctx.schema.tenantUsers.userId, admin.user_id));
    assert.deepEqual(tenantMemberships, []);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/admin/platform-administrators/" + admin.user_id,
      headers: { authorization: "Bearer test-admin-token" },
      payload: {
        display_name: "Platform Admin Updated",
        status: "DISABLED"
      }
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json<{ display_name: string; status: string }>().display_name, "Platform Admin Updated");
    assert.equal(updated.json<{ display_name: string; status: string }>().status, "DISABLED");

    const oldAccount = await readCredentialAccount(ctx, admin.user_id);
    const createContext = await ctx.getAccountSetupContext(createSetupToken);
    assert.equal(createContext.kind, "platform_admin");
    assert.equal(createContext.requires_pin, false);
    await ctx.completeAccountSetup(createSetupToken, {
      password: "platform-created-password"
    });
    const setupAccount = await readCredentialAccount(ctx, admin.user_id);
    assert.ok(oldAccount?.password);
    assert.ok(setupAccount?.password);
    assert.notEqual(setupAccount.password, oldAccount.password);

    const reset = await app.inject({
      method: "POST",
      url: "/api/admin/platform-administrators/" + admin.user_id + "/reset-password",
      headers: { authorization: "Bearer test-admin-token" },
      payload: {}
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(reset.json<{ email_sent: boolean }>().email_sent, true);
    assert.equal(sentEmails.length, 2);
    const resetSetupToken = extractSetupToken(sentEmails[1]?.text ?? "");

    await ctx.completeAccountSetup(resetSetupToken, {
      password: "platform-reset-password"
    });
    const newAccount = await readCredentialAccount(ctx, admin.user_id);
    assert.ok(newAccount?.password);
    assert.notEqual(newAccount.password, setupAccount.password);
  } finally {
    await app.close();
    ctx.resetResendClientFactoryForTest();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.PLATFORM_ADMIN_SETUP_PUBLIC_BASE_URL;
    delete process.env.RELAY_ADMIN_TOKEN;
  }
});

async function loadModules() {
  const dbClient = await import("../db/client.js");
  const schema = await import("../db/schema.js");
  const provisioning = await import("../store/provisioningStore.js");
  const server = await import("../server.js");
  const authRoutes = await import("../routes/authRoutes.js");
  const powerSyncRoutes = await import("../routes/powersyncRoutes.js");
  const adminRoutes = await import("../routes/adminRoutes.js");
  const userStore = await import("../store/userStore.js");
  const accountSetupStore = await import("../store/accountSetupStore.js");
  const email = await import("../services/email/resend.js");
  const nats = await import("../lib/nats.js");
  const auth = await import("../auth.js");
  const drizzle = await import("drizzle-orm");

  return {
    ...dbClient,
    ...provisioning,
    ...server,
    ...authRoutes,
    ...powerSyncRoutes,
    ...adminRoutes,
    ...userStore,
    ...accountSetupStore,
    ...email,
    ...nats,
    auth: auth.auth,
    schema,
    and: drizzle.and,
    eq: drizzle.eq,
    inArray: drizzle.inArray,
    db: dbClient.getDrizzleDatabase()
  };
}

function assertModules() {
  assert.ok(modules);
  return modules;
}

function installNatsTestDouble(ctx: NonNullable<typeof modules>) {
  ctx.setNatsConnectForTest((async () => ({
    publish() {
      // NATS is only a wake-up poke in these integration tests.
    },
    async close() {
      return undefined;
    }
  })) as never);
}

function extractCookieHeader(value: string | string[] | number | undefined) {
  if (Array.isArray(value)) {
    return value.map((cookie) => cookie.split(";")[0]).join("; ");
  }

  if (typeof value === "string") {
    return value.split(";")[0];
  }

  return "";
}

async function seedTenantLocation(ctx: NonNullable<typeof modules>) {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const tenantId = "tenant_test_" + suffix;
  const locationId = "location_test_" + suffix;
  createdTenantIds.add(tenantId);

  await ctx.db.insert(ctx.schema.tenants).values({
    id: tenantId,
    name: "Tenant Test",
    slug: "tenant-test-" + suffix,
    email: null,
    phone: null,
    website: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await ctx.db.insert(ctx.schema.locations).values({
    id: locationId,
    tenantId,
    name: "Location Test",
    slug: "location-test-" + suffix,
    address: null,
    localMasterInstanceId: null,
    serviceMode: "TABLE_SERVICE",
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return { suffix, tenantId, locationId };
}

async function cleanupCreatedTenants(ctx: NonNullable<typeof modules>) {
  const tenantIds = Array.from(createdTenantIds);
  if (tenantIds.length === 0) {
    await cleanupCreatedPlatformAdmins(ctx);
    return;
  }

  const userRows = await ctx.db
    .select({ userId: ctx.schema.tenantUsers.userId })
    .from(ctx.schema.tenantUsers)
    .where(ctx.inArray(ctx.schema.tenantUsers.tenantId, tenantIds));
  const userIds = userRows.map((row) => row.userId);

  await ctx.db.delete(ctx.schema.relayCommands).where(ctx.inArray(ctx.schema.relayCommands.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.localMasterCredentials).where(ctx.inArray(ctx.schema.localMasterCredentials.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.localMasterPairingSessions).where(ctx.inArray(ctx.schema.localMasterPairingSessions.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.catalogOutputStations).where(ctx.inArray(ctx.schema.catalogOutputStations.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.tenantUserLocations).where(ctx.inArray(ctx.schema.tenantUserLocations.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.tenantUsers).where(ctx.inArray(ctx.schema.tenantUsers.tenantId, tenantIds));
  if (userIds.length > 0) {
    await ctx.db.delete(ctx.schema.accounts).where(ctx.inArray(ctx.schema.accounts.userId, userIds));
    await ctx.db.delete(ctx.schema.users).where(ctx.inArray(ctx.schema.users.id, userIds));
  }
  await ctx.db.delete(ctx.schema.locations).where(ctx.inArray(ctx.schema.locations.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.tenants).where(ctx.inArray(ctx.schema.tenants.id, tenantIds));
  createdTenantIds.clear();
  await cleanupCreatedPlatformAdmins(ctx);
}

async function cleanupCreatedPlatformAdmins(ctx: NonNullable<typeof modules>) {
  const emails = Array.from(createdPlatformAdminEmails);
  if (emails.length === 0) {
    return;
  }

  const userRows = await ctx.db
    .select({ userId: ctx.schema.users.id })
    .from(ctx.schema.users)
    .where(ctx.inArray(ctx.schema.users.email, emails));
  const userIds = userRows.map((row) => row.userId);

  if (userIds.length > 0) {
    await ctx.db.delete(ctx.schema.accounts).where(ctx.inArray(ctx.schema.accounts.userId, userIds));
    await ctx.db.delete(ctx.schema.sessions).where(ctx.inArray(ctx.schema.sessions.userId, userIds));
    await ctx.db.delete(ctx.schema.users).where(ctx.inArray(ctx.schema.users.id, userIds));
  }

  createdPlatformAdminEmails.clear();
}

function extractSetupToken(text: string) {
  const match = text.match(/account-setup\?token=([A-Za-z0-9_-]+)/);

  assert.ok(match?.[1], "Expected account setup token in email text.");
  return match[1];
}

async function readCredentialAccount(ctx: NonNullable<typeof modules>, userId: string) {
  return (await ctx.db
    .select()
    .from(ctx.schema.accounts)
    .where(ctx.and(ctx.eq(ctx.schema.accounts.userId, userId), ctx.eq(ctx.schema.accounts.providerId, "credential")))
    .limit(1))[0] ?? null;
}

async function waitForBootstrapRefreshCount(
  ctx: NonNullable<typeof modules>,
  tenantId: string,
  locationId: string,
  minimumCount: number
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rows = await ctx.db
      .select({ id: ctx.schema.relayCommands.id })
      .from(ctx.schema.relayCommands)
      .where(ctx.and(
        ctx.eq(ctx.schema.relayCommands.tenantId, tenantId),
        ctx.eq(ctx.schema.relayCommands.locationId, locationId),
        ctx.eq(ctx.schema.relayCommands.type, "ADMIN_BOOTSTRAP_REFRESH")
      ));

    if (rows.length >= minimumCount) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.fail("Timed out waiting for ADMIN_BOOTSTRAP_REFRESH command.");
}
