import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";

import { getDrizzleDatabase } from "../db/client.js";
import { requireLocalMasterCredential } from "../store/provisioningStore.js";
import * as schema from "../db/schema.js";

const tableMap: Record<string, any> = {
  tenants: schema.tenants,
  locations: schema.locations,
  layout_floors: schema.layoutFloors,
  layout_areas: schema.layoutAreas,
  layout_tables: schema.layoutTables,
  catalog_categories: schema.catalogCategories,
  catalog_taxes: schema.catalogTaxes,
  catalog_output_stations: schema.catalogOutputStations,
  catalog_products: schema.catalogProducts,
  orders: schema.orders,
  order_items: schema.orderItems,
  station_pickups: schema.stationPickups,
  kds_tickets: schema.kdsTickets,
  payments: schema.payments
};

function toCamelCase(str: string): string {
  return str.replace(/([-_][a-z])/gi, ($1) => {
    return $1.toUpperCase().replace("-", "").replace("_", "");
  });
}

function mapRowToDrizzle(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    result[toCamelCase(key)] = value;
  }
  return result;
}

export async function registerPowerSyncRoutes(app: FastifyInstance) {
  app.get("/api/local-masters/powersync-token", async (request) => {
    const authorization = request.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
    const credential = await requireLocalMasterCredential(token);

    const secret = new TextEncoder().encode(
      process.env.POWERSYNC_JWT_SECRET ?? "some-dev-secret-that-is-long-enough-for-hs256"
    );

    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: "dev-key-1" })
      .setIssuedAt()
      .setSubject(`${credential.tenantId}:${credential.locationId}`)
      .setExpirationTime("24h")
      .sign(secret);

    return { token: jwt };
  });

  app.post("/api/local-masters/powersync-upload", async (request, reply) => {
    const authorization = request.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
    await requireLocalMasterCredential(token);

    const body = request.body as {
      client_id: string;
      mutations: Array<{
        op: "PUT" | "PATCH" | "DELETE";
        table: string;
        id: string;
        row?: Record<string, any>;
      }>;
    };

    const db = getDrizzleDatabase();

    await db.transaction(async (tx) => {
      for (const mutation of body.mutations || []) {
        const table = tableMap[mutation.table];
        if (!table) {
          console.warn(`[PowerSync Upload] Unknown table: ${mutation.table}`);
          continue;
        }

        if (mutation.op === "PUT" || mutation.op === "PATCH") {
          if (!mutation.row) continue;
          const mappedRow = mapRowToDrizzle(mutation.row);
          mappedRow.id = mutation.id;

          await tx
            .insert(table)
            .values(mappedRow)
            .onConflictDoUpdate({
              target: table.id,
              set: mappedRow
            });
        } else if (mutation.op === "DELETE") {
          await tx
            .delete(table)
            .where(eq(table.id, mutation.id));
        }
      }
    });

    return reply.status(200).send({ status: "OK" });
  });
}
