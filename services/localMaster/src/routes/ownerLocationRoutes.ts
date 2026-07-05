import type { FastifyInstance } from "fastify";

import { getRelayRuntimeBinding } from "../cloudBinding.js";
import { broadcast } from "../realtime.js";
import { pushTableLayoutToRelay } from "../relayLayoutSync.js";
import {
  createLayoutArea,
  createLayoutFloor,
  createLayoutTable,
  deleteLayoutArea,
  deleteLayoutFloor,
  deleteLayoutTable,
  getTableLayout,
  listOwnerLocations,
  updateLayoutArea,
  updateLayoutFloor,
  updateLayoutTable
} from "../store.js";
import { TableLayoutError } from "../store/tableStore.js";
import type {
  LayoutAreaCreateRequest,
  LayoutAreaUpdateRequest,
  LayoutFloorCreateRequest,
  LayoutFloorUpdateRequest,
  LayoutTableCreateRequest,
  LayoutTableUpdateRequest
} from "../types.js";

type LocationParams = { locationId: string };
type FloorParams = LocationParams & { floorId: string };
type AreaParams = LocationParams & { areaId: string };
type TableParams = LocationParams & { tableId: string };

export async function registerOwnerLocationRoutes(app: FastifyInstance) {
  app.get("/api/owner/locations", async () => ({ data: listOwnerLocations() }));

  app.get<{ Params: LocationParams }>(
    "/api/owner/locations/:locationId/table-layout",
    async (request) => getTableLayout(request.params.locationId)
  );

  app.post<{ Params: LocationParams; Body: LayoutFloorCreateRequest }>(
    "/api/owner/locations/:locationId/floors",
    async (request, reply) => {
      const floor = createLayoutFloor(request.params.locationId, request.body);
      broadcastTableLayoutUpdated(request.params.locationId, "FLOOR_CREATED", floor);
      return reply.code(201).send(floor);
    }
  );

  app.patch<{ Params: FloorParams; Body: LayoutFloorUpdateRequest }>(
    "/api/owner/locations/:locationId/floors/:floorId",
    async (request) => {
      const floor = updateLayoutFloor(request.params.locationId, request.params.floorId, request.body);
      broadcastTableLayoutUpdated(request.params.locationId, "FLOOR_UPDATED", floor);
      return floor;
    }
  );

  app.delete<{ Params: FloorParams }>(
    "/api/owner/locations/:locationId/floors/:floorId",
    async (request, reply) => {
      deleteLayoutFloor(request.params.locationId, request.params.floorId);
      broadcastTableLayoutUpdated(request.params.locationId, "FLOOR_DELETED", { id: request.params.floorId });
      return reply.code(204).send();
    }
  );

  app.post<{ Params: LocationParams; Body: LayoutAreaCreateRequest }>(
    "/api/owner/locations/:locationId/areas",
    async (request, reply) => {
      const area = createLayoutArea(request.params.locationId, request.body);
      broadcastTableLayoutUpdated(request.params.locationId, "AREA_CREATED", area);
      return reply.code(201).send(area);
    }
  );

  app.patch<{ Params: AreaParams; Body: LayoutAreaUpdateRequest }>(
    "/api/owner/locations/:locationId/areas/:areaId",
    async (request) => {
      const area = updateLayoutArea(request.params.locationId, request.params.areaId, request.body);
      broadcastTableLayoutUpdated(request.params.locationId, "AREA_UPDATED", area);
      return area;
    }
  );

  app.delete<{ Params: AreaParams }>(
    "/api/owner/locations/:locationId/areas/:areaId",
    async (request, reply) => {
      deleteLayoutArea(request.params.locationId, request.params.areaId);
      broadcastTableLayoutUpdated(request.params.locationId, "AREA_DELETED", { id: request.params.areaId });
      return reply.code(204).send();
    }
  );

  app.post<{ Params: LocationParams; Body: LayoutTableCreateRequest }>(
    "/api/owner/locations/:locationId/tables",
    async (request, reply) => {
      const table = createLayoutTable(request.params.locationId, request.body);
      broadcastTableLayoutUpdated(request.params.locationId, "TABLE_CREATED", table);
      return reply.code(201).send(table);
    }
  );

  app.patch<{ Params: TableParams; Body: LayoutTableUpdateRequest }>(
    "/api/owner/locations/:locationId/tables/:tableId",
    async (request) => {
      const table = updateLayoutTable(request.params.locationId, request.params.tableId, request.body);
      broadcastTableLayoutUpdated(request.params.locationId, "TABLE_UPDATED", table);
      return table;
    }
  );

  app.delete<{ Params: TableParams }>(
    "/api/owner/locations/:locationId/tables/:tableId",
    async (request, reply) => {
      deleteLayoutTable(request.params.locationId, request.params.tableId);
      broadcastTableLayoutUpdated(request.params.locationId, "TABLE_DELETED", { id: request.params.tableId });
      return reply.code(204).send();
    }
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof TableLayoutError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }

    return reply.send(error);
  });
}

function broadcastTableLayoutUpdated(locationId: string, action: string, entity: unknown) {
  broadcast("TABLE_LAYOUT_UPDATED", { location_id: locationId, action, entity });
  const binding = getRelayRuntimeBinding();
  if (binding?.location_id === locationId) {
    void pushTableLayoutToRelay(binding);
  }
}
