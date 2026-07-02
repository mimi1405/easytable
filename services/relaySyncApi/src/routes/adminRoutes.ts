import type { FastifyInstance } from "fastify";

import { createLocation, listLocations, updateLocation } from "../store/locationStore.js";
import { createOutputStation, listOutputStations, updateOutputStation } from "../store/outputStationStore.js";
import { createTenant, listTenants, updateTenant } from "../store/tenantStore.js";
import type {
  CatalogOutputStationCreateRequest,
  CatalogOutputStationUpdateRequest,
  LocationCreateRequest,
  LocationUpdateRequest,
  TenantCreateRequest,
  TenantUpdateRequest
} from "../types.js";

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/api/admin/tenants", async () => ({ data: await listTenants() }));

  app.post<{ Body: TenantCreateRequest }>("/api/admin/tenants", async (request, reply) =>
    reply.code(201).send(await createTenant(request.body)),
  );

  app.patch<{ Params: { tenantId: string }; Body: TenantUpdateRequest }>(
    "/api/admin/tenants/:tenantId",
    async (request) => updateTenant(request.params.tenantId, request.body),
  );

  app.get<{ Params: { tenantId: string } }>(
    "/api/admin/tenants/:tenantId/locations",
    async (request) => ({ data: await listLocations(request.params.tenantId) }),
  );

  app.post<{ Params: { tenantId: string }; Body: LocationCreateRequest }>(
    "/api/admin/tenants/:tenantId/locations",
    async (request, reply) => reply.code(201).send(await createLocation(request.params.tenantId, request.body)),
  );

  app.patch<{ Params: { tenantId: string; locationId: string }; Body: LocationUpdateRequest }>(
    "/api/admin/tenants/:tenantId/locations/:locationId",
    async (request) => updateLocation(request.params.tenantId, request.params.locationId, request.body),
  );

  app.get<{ Params: { tenantId: string; locationId: string } }>(
    "/api/admin/tenants/:tenantId/locations/:locationId/output-stations",
    async (request) => ({ data: await listOutputStations(request.params.tenantId, request.params.locationId) }),
  );

  app.post<{ Params: { tenantId: string; locationId: string }; Body: CatalogOutputStationCreateRequest }>(
    "/api/admin/tenants/:tenantId/locations/:locationId/output-stations",
    async (request, reply) =>
      reply.code(201).send(await createOutputStation(request.params.tenantId, request.params.locationId, request.body)),
  );

  app.patch<{
    Params: { tenantId: string; locationId: string; stationId: string };
    Body: CatalogOutputStationUpdateRequest;
  }>(
    "/api/admin/tenants/:tenantId/locations/:locationId/output-stations/:stationId",
    async (request) => updateOutputStation(request.params.tenantId, request.params.locationId, request.params.stationId, request.body),
  );
}
