import type { FastifyInstance } from "fastify";

import { getOpenTableOrderBasket, getTableLayout, listTables } from "../store.js";

export async function registerTableRoutes(app: FastifyInstance) {
  app.get("/api/tables", async () => ({ data: listTables() }));
  app.get("/api/table-layout", async () => getTableLayout());
  app.get<{ Params: { tableId: string } }>(
    "/api/tables/:tableId/open-basket",
    async (request) => getOpenTableOrderBasket(request.params.tableId)
  );
}
