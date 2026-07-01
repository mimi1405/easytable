import type { FastifyInstance } from "fastify";

import { registerBusinessRoutes } from "./routes/businessRoutes.js";
import { registerCatalogRoutes } from "./routes/catalogRoutes.js";
import { registerHealthRoutes } from "./routes/healthRoutes.js";
import { registerOrderRoutes } from "./routes/orderRoutes.js";
import { registerPairingRoutes } from "./routes/pairingRoutes.js";
import { registerTableRoutes } from "./routes/tableRoutes.js";

export async function registerApiRoutes(app: FastifyInstance) {
  await app.register(registerHealthRoutes);
  await app.register(registerPairingRoutes);
  await app.register(registerCatalogRoutes);
  await app.register(registerTableRoutes);
  await app.register(registerBusinessRoutes);
  await app.register(registerOrderRoutes);
}
