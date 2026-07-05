import type { FastifyInstance } from "fastify";

import { ackRelayCommand, getLocalMasterBootstrap, listPendingRelayCommands, pairLocalMaster } from "../store/provisioningStore.js";
import { replaceLocalMasterCatalog } from "../store/catalogRelayStore.js";
import { replaceLocalMasterOperations } from "../store/operationsRelayStore.js";
import { replaceLocalMasterTableLayout } from "../store/tableLayoutStore.js";
import type {
  LocalMasterOperationsSnapshot,
  LocalMasterPairRequest,
  OwnerCatalogSnapshot,
  RelayCommandAckRequest,
  TableLayout
} from "../types.js";

export async function registerLocalMasterRoutes(app: FastifyInstance) {
  app.post<{ Body: LocalMasterPairRequest }>("/api/local-masters/pair", async (request, reply) =>
    reply.code(201).send(await pairLocalMaster(request.body))
  );

  app.get("/api/local-masters/commands/pending", async (request) =>
    ({ data: await listPendingRelayCommands(readBearerToken(request.headers.authorization)) })
  );

  app.get("/api/local-masters/bootstrap", async (request) =>
    getLocalMasterBootstrap(readBearerToken(request.headers.authorization))
  );

  app.post<{ Params: { commandId: string }; Body: RelayCommandAckRequest }>(
    "/api/local-masters/commands/:commandId/ack",
    async (request) => ackRelayCommand(readBearerToken(request.headers.authorization), request.params.commandId, request.body)
  );

  app.put<{ Body: TableLayout }>("/api/local-masters/table-layout", async (request) =>
    replaceLocalMasterTableLayout(readBearerToken(request.headers.authorization), request.body)
  );

  app.put<{ Body: OwnerCatalogSnapshot }>("/api/local-masters/catalog", async (request) =>
    replaceLocalMasterCatalog(readBearerToken(request.headers.authorization), request.body)
  );

  app.put<{ Body: LocalMasterOperationsSnapshot }>("/api/local-masters/operations", async (request) =>
    replaceLocalMasterOperations(readBearerToken(request.headers.authorization), request.body)
  );
}

function readBearerToken(authorization: string | undefined) {
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}
