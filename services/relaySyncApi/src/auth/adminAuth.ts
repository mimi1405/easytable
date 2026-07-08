import type { FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";

import { auth } from "../auth.js";
import { getDrizzleDatabase } from "../db/client.js";
import { tenantUsers } from "../db/schema.js";
import { ApiError } from "../store/errors.js";

export async function requireAdminToken(request: FastifyRequest) {
  const configuredToken = process.env.RELAY_ADMIN_TOKEN?.trim();
  const authorization = request.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";

  if (configuredToken && token === configuredToken) {
    return;
  }

  await requirePlatformAdminSession(request);
}

export async function requirePlatformAdminSession(request: FastifyRequest) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });

  if (!session) {
    throw new ApiError("Platform admin session is required.", 401);
  }

  if (session.user.role !== "platform_admin") {
    throw new ApiError("Platform admin role is required.", 403);
  }

  const tenantMembership = (await getDrizzleDatabase()
    .select({ tenantId: tenantUsers.tenantId })
    .from(tenantUsers)
    .where(eq(tenantUsers.userId, session.user.id))
    .limit(1))[0];

  if (tenantMembership) {
    throw new ApiError("Tenant users are not platform administrators.", 403);
  }

  return session;
}
