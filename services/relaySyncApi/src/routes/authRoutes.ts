import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";

export async function registerAuthRoutes(app: FastifyInstance) {
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
