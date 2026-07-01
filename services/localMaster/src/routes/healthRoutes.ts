import type { FastifyInstance } from "fastify";

import { getLocalMasterIdentity } from "../pairing.js";
import { connectedClientCount } from "../realtime.js";
import { listOpenOrders } from "../store.js";

function getHealthPayload() {
  return {
    ...getLocalMasterIdentity(),
    clients: connectedClientCount(),
    orders: listOpenOrders().length
  };
}

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => getHealthPayload());
  app.get("/api/local-master/identity", async () => getHealthPayload());
}
