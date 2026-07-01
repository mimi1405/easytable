import type { FastifyInstance } from "fastify";

import { createPairingSession, pairTerminal, recordTerminalHeartbeat } from "../pairing.js";
import { createPairingSessionSchema, pairTerminalSchema, terminalHeartbeatSchema } from "../schemas.js";
import type { PairingSessionRequest, PairTerminalRequest, TerminalHeartbeatRequest } from "../types.js";
import type { PosRequestBody } from "./types.js";

export async function registerPairingRoutes(app: FastifyInstance) {
  app.post<{ Body: PosRequestBody<PairingSessionRequest> }>(
    "/api/local-master/pairing-sessions",
    { schema: createPairingSessionSchema },
    async (request, reply) => reply.code(201).send(createPairingSession(request.body.request))
  );

  app.post<{ Body: PosRequestBody<PairTerminalRequest> }>(
    "/api/local-master/pair",
    { schema: pairTerminalSchema },
    async (request, reply) => reply.code(201).send(pairTerminal(request.body.request))
  );

  app.post<{ Params: { terminalId: string }; Body: PosRequestBody<TerminalHeartbeatRequest> }>(
    "/api/local-master/terminals/:terminalId/heartbeat",
    { schema: terminalHeartbeatSchema },
    async (request) => recordTerminalHeartbeat(request.params.terminalId, request.body.request)
  );
}
