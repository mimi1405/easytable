import type { FastifyInstance } from "fastify";

import { createOwnerCatalogCommand, getOwnerCatalog } from "../store/catalogRelayStore.js";
import type { OwnerCatalogCommandRequest } from "../types.js";

export async function registerOwnerRoutes(app: FastifyInstance) {
  app.get<{ Params: { locationId: string } }>("/api/owner/locations/:locationId/catalog", async (request) =>
    getOwnerCatalog(request.headers.authorization, request.params.locationId)
  );

  app.post<{ Params: { locationId: string }; Body: OwnerCatalogCommandRequest }>(
    "/api/owner/locations/:locationId/catalog/commands",
    async (request, reply) =>
      reply.code(202).send(await createOwnerCatalogCommand(request.headers.authorization, request.params.locationId, request.body))
  );
}
