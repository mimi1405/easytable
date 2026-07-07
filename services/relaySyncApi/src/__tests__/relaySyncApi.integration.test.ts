import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import Fastify from "fastify";

const testDatabaseUrl = process.env.RELAY_SYNC_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const hasDatabase = Boolean(testDatabaseUrl);
const createdTenantIds = new Set<string>();

let modules: Awaited<ReturnType<typeof loadModules>> | null = null;

before(async () => {
  if (!hasDatabase) {
    return;
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.RELAY_COMMAND_REDELIVERY_TIMEOUT_MS = "5000";
  modules = await loadModules();
  await modules.initializeDatabase();
});

afterEach(async () => {
  if (modules) {
    await cleanupCreatedTenants(modules);
  }
});

after(async () => {
  if (modules) {
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

async function loadModules() {
  const dbClient = await import("../db/client.js");
  const schema = await import("../db/schema.js");
  const provisioning = await import("../store/provisioningStore.js");
  const server = await import("../server.js");
  const powerSyncRoutes = await import("../routes/powersyncRoutes.js");
  const drizzle = await import("drizzle-orm");

  return {
    ...dbClient,
    ...provisioning,
    ...server,
    ...powerSyncRoutes,
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
    return;
  }

  await ctx.db.delete(ctx.schema.relayCommands).where(ctx.inArray(ctx.schema.relayCommands.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.localMasterCredentials).where(ctx.inArray(ctx.schema.localMasterCredentials.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.localMasterPairingSessions).where(ctx.inArray(ctx.schema.localMasterPairingSessions.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.catalogOutputStations).where(ctx.inArray(ctx.schema.catalogOutputStations.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.tenantUserLocations).where(ctx.inArray(ctx.schema.tenantUserLocations.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.tenantUsers).where(ctx.inArray(ctx.schema.tenantUsers.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.locations).where(ctx.inArray(ctx.schema.locations.tenantId, tenantIds));
  await ctx.db.delete(ctx.schema.tenants).where(ctx.inArray(ctx.schema.tenants.id, tenantIds));
  createdTenantIds.clear();
}
