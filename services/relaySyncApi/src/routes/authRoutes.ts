import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { auth } from "../auth.js";
import { getDrizzleDatabase } from "../db/client.js";
import { tenantUsers, tenants } from "../db/schema.js";
import { completeAccountSetup, getAccountSetupContext } from "../store/accountSetupStore.js";
import type { AccountSetupCompleteRequest } from "../types.js";

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/me", async (request, reply) => {
    const host = request.headers.host ?? "localhost";
    const protocol = request.headers["x-forwarded-proto"] as string ?? request.protocol ?? "http";
    const url = new URL(request.url, `${protocol}://${host}`);
    const headers = fromNodeHeaders(request.headers);

    const req = new Request(url.toString(), {
      method: "GET",
      headers,
    });

    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const db = getDrizzleDatabase();
    const userTenants = await db
      .select({
        tenantId: tenantUsers.tenantId,
        role: tenantUsers.role,
        tenantName: tenants.name,
      })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
      .where(eq(tenantUsers.userId, session.user.id));

    return {
      user: session.user,
      tenants: userTenants,
    };
  });

  app.get<{ Params: { token: string } }>("/api/auth/account-setup/:token", async (request) =>
    getAccountSetupContext(request.params.token)
  );

  app.post<{ Params: { token: string }; Body: AccountSetupCompleteRequest }>("/api/auth/account-setup/:token", async (request) =>
    completeAccountSetup(request.params.token, request.body ?? {})
  );

  app.all("/api/auth/*", async (request, reply) => {
    const host = request.headers.host ?? "localhost";
    const protocol = request.headers["x-forwarded-proto"] as string ?? request.protocol ?? "http";
    const url = new URL(request.url, `${protocol}://${host}`);

    const headers = fromNodeHeaders(request.headers);

    const req = new Request(url.toString(), {
      method: request.method,
      headers,
      ...(request.body && request.method !== "GET"
        ? { body: JSON.stringify(request.body) }
        : {}),
    });

    const response = await auth.handler(req);

    reply.status(response.status);
    response.headers.forEach((value, key) => {
      reply.header(key, value);
    });

    return reply.send(response.body ? await response.text() : null);
  });
}
