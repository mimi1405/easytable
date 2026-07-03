import type { FastifyInstance } from "fastify";

import { broadcast } from "../realtime.js";
import { currentBusinessDateSchema, dayClosePreviewSchema, saveDayCloseSchema } from "../schemas.js";
import {
  createLocalDevice,
  getCurrentBusinessDate,
  getDayClosePreview,
  getPosDeviceBinding,
  clearPrintLogs,
  listLocalDevices,
  listPrintLogs,
  listPrintJobs,
  listStationDeviceBindings,
  loadPosSettings,
  saveDayClose,
  testLocalDevice,
  retryPrintJob,
  updateLocalDevice,
  updatePosDeviceBinding,
  updateStationDeviceBinding
} from "../store.js";
import type {
  CurrentBusinessDateRequest,
  DayClosePreviewRequest,
  LocalDeviceCreateRequest,
  LocalDeviceUpdateRequest,
  PosDeviceBindingUpdateRequest,
  RetryPrintJobRequest,
  SaveDayCloseRequest,
  StationDeviceBindingUpdateRequest
} from "../types.js";
import type { PosRequestBody } from "./types.js";

export async function registerBusinessRoutes(app: FastifyInstance) {
  app.get("/api/pos-settings", async () => loadPosSettings());

  app.get("/api/local-devices", async () => ({ data: listLocalDevices() }));

  app.post<{ Body: PosRequestBody<LocalDeviceCreateRequest> }>(
    "/api/local-devices",
    async (request, reply) => {
      const device = createLocalDevice(request.body.request);
      broadcastDeviceConfigUpdated("LOCAL_DEVICE_CREATED", device);
      return reply.code(201).send(device);
    }
  );

  app.patch<{ Params: { deviceId: string }; Body: PosRequestBody<LocalDeviceUpdateRequest> }>(
    "/api/local-devices/:deviceId",
    async (request) => {
      const device = updateLocalDevice(request.params.deviceId, request.body.request);
      broadcastDeviceConfigUpdated("LOCAL_DEVICE_UPDATED", device);
      return device;
    }
  );

  app.post<{ Params: { deviceId: string } }>(
    "/api/local-devices/:deviceId/test",
    async (request) => testLocalDevice(request.params.deviceId)
  );

  app.get("/api/print-logs", async () => ({ data: listPrintLogs() }));

  app.get("/api/print-jobs", async () => ({ data: listPrintJobs() }));

  app.post<{ Params: { jobId: string }; Body: PosRequestBody<RetryPrintJobRequest> }>(
    "/api/print-jobs/:jobId/retry",
    async (request) => retryPrintJob(request.params.jobId, request.body.request)
  );

  app.post("/api/print-logs/clear", async () => clearPrintLogs());

  app.get<{ Params: { terminalId: string } }>(
    "/api/pos-device-bindings/:terminalId",
    async (request) => getPosDeviceBinding(request.params.terminalId)
  );

  app.post<{ Params: { terminalId: string }; Body: PosRequestBody<PosDeviceBindingUpdateRequest> }>(
    "/api/pos-device-bindings/:terminalId",
    async (request) => {
      const binding = updatePosDeviceBinding(request.params.terminalId, request.body.request);
      broadcastDeviceConfigUpdated("POS_DEVICE_BINDING_UPDATED", binding);
      return binding;
    }
  );

  app.get("/api/station-device-bindings", async () => ({ data: listStationDeviceBindings() }));

  app.post<{ Params: { stationId: string }; Body: PosRequestBody<StationDeviceBindingUpdateRequest> }>(
    "/api/station-device-bindings/:stationId",
    async (request) => {
      const binding = updateStationDeviceBinding(request.params.stationId, request.body.request);
      broadcastDeviceConfigUpdated("STATION_DEVICE_BINDING_UPDATED", binding);
      return binding;
    }
  );

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

function broadcastDeviceConfigUpdated(action: string, entity: unknown) {
  broadcast("DEVICE_CONFIG_UPDATED", { action, entity });
}
