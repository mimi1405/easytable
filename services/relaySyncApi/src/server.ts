import cors from "@fastify/cors";
import Fastify from "fastify";

import { closeDatabase, initializeDatabase } from "./db/client.js";
import { registerAdminRoutes } from "./routes/adminRoutes.js";
import { registerHealthRoutes } from "./routes/healthRoutes.js";
import { registerLocalMasterRoutes } from "./routes/localMasterRoutes.js";
import { registerOwnerRoutes } from "./routes/ownerRoutes.js";
import { registerStaffRoutes } from "./routes/staffRoutes.js";
import { ApiError } from "./store/errors.js";

export async function buildServer() {
  const app = Fastify({ logger: true });

  await initializeDatabase();

  await app.register(cors, {
    origin: true,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }

    app.log.error({ error }, "Unhandled relaySyncApi error");
    return reply.code(500).send({ error: "Internal server error." });
  });

  await app.register(registerHealthRoutes);
  await app.register(registerAdminRoutes);
  await app.register(registerLocalMasterRoutes);
  await app.register(registerStaffRoutes);
  await app.register(registerOwnerRoutes);

  app.addHook("onClose", async () => {
    await closeDatabase();
  });

  return app;
}
