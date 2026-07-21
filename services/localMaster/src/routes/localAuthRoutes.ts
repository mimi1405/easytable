import type { FastifyInstance } from "fastify";
import { listLocalLoginUsers, loginWithLocalPin, requireLocalSession, requireSalesDevice } from "../localAuth.js";
import { pairTerminal } from "../pairing.js";

export async function registerLocalAuthRoutes(app: FastifyInstance) {
  app.get("/api/local-auth/users", async (request) => {
    requireSalesDevice(request.headers["x-easytable-device-id"] as string | undefined, request.headers["x-easytable-device-secret"] as string | undefined);
    return listLocalLoginUsers();
  });
  app.post<{ Body: { request: { code: string; device_name: string; local_master_url: string; device_fingerprint?: string } } }>(
    "/api/local-auth/devices/pair",
    async (request, reply) => reply.code(201).send(pairTerminal({
      code: request.body.request.code,
      terminal_name: request.body.request.device_name,
      local_master_url: request.body.request.local_master_url,
      device_fingerprint: request.body.request.device_fingerprint,
      role: "STAFF_DEVICE",
    })),
  );
  app.post<{ Body: { request: { device_id: string; device_secret: string; user_id: string; pin: string } } }>(
    "/api/local-auth/pin",
    async (request) => loginWithLocalPin(request.body.request),
  );
  app.get("/api/local-auth/session", async (request) => requireLocalSession(request.headers.authorization));
}
