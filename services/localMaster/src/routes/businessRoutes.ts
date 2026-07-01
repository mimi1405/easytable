import type { FastifyInstance } from "fastify";

import { currentBusinessDateSchema, dayClosePreviewSchema, saveDayCloseSchema } from "../schemas.js";
import {
  getCurrentBusinessDate,
  getDayClosePreview,
  loadPosSettings,
  saveDayClose
} from "../store.js";
import type {
  CurrentBusinessDateRequest,
  DayClosePreviewRequest,
  SaveDayCloseRequest
} from "../types.js";
import type { PosRequestBody } from "./types.js";

export async function registerBusinessRoutes(app: FastifyInstance) {
  app.get("/api/pos-settings", async () => loadPosSettings());

  app.post<{ Body: PosRequestBody<CurrentBusinessDateRequest> }>(
    "/api/business-date/current",
    { schema: currentBusinessDateSchema },
    async (request) => getCurrentBusinessDate(request.body.request)
  );

  app.post<{ Body: PosRequestBody<DayClosePreviewRequest> }>(
    "/api/day-close/preview",
    { schema: dayClosePreviewSchema },
    async (request) => getDayClosePreview(request.body.request)
  );

  app.post<{ Body: PosRequestBody<SaveDayCloseRequest> }>(
    "/api/day-close",
    { schema: saveDayCloseSchema },
    async (request, reply) => reply.code(201).send(saveDayClose(request.body.request))
  );
}
