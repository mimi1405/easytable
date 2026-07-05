import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import { registerApiRoutes } from "./routes.js";
import { registerRealtimeRoutes } from "./realtime.js";

export type ServerOptions = {
  logger?: boolean;
};

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        allErrors: true
      }
    }
  });

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"]
  });

  await app.register(websocket, {
    options: {
      maxPayload: 16 * 1024
    }
  });

  await app.register(registerApiRoutes);
  await app.register(registerRealtimeRoutes);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;

    request.log.warn({ error }, "Request failed");

    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : error.message
    });
  });

  return app;
}

