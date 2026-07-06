import type { FastifyInstance } from "fastify";

import { requireAdminToken } from "../auth/adminAuth.js";
import { createLocation, listLocations, updateLocation } from "../store/locationStore.js";
import { createOutputStation, deleteOutputStation, listOutputStations, updateOutputStation } from "../store/outputStationStore.js";
import { createLocalMasterPairingSession, getCurrentLocalMasterPairingSession, getOnboardingStatus } from "../store/provisioningStore.js";
import { createTenant, listTenants, updateTenant } from "../store/tenantStore.js";
import { createLocationUser, listLocationUsers, updateLocationUser } from "../store/userStore.js";
import type {
  CatalogOutputStationCreateRequest,
  CatalogOutputStationUpdateRequest,
  LocationCreateRequest,
  LocationUpdateRequest,
  TenantLocationUserCreateRequest,
  TenantLocationUserUpdateRequest,
  TenantCreateRequest,
  TenantUpdateRequest
} from "../types.js";

export async function registerAdminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request) => requireAdminToken(request));

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

  app.post<{ Params: { tenantId: string; locationId: string } }>(
    "/api/admin/tenants/:tenantId/locations/:locationId/pairing-sessions",
    async (request, reply) =>
      reply.code(201).send(await createLocalMasterPairingSession(request.params.tenantId, request.params.locationId)),
  );

  app.get<{ Params: { tenantId: string; locationId: string } }>(
    "/api/admin/tenants/:tenantId/locations/:locationId/pairing-sessions/current",
    async (request) => getCurrentLocalMasterPairingSession(request.params.tenantId, request.params.locationId),
  );

  app.get<{ Params: { tenantId: string; locationId: string } }>(
    "/api/admin/tenants/:tenantId/locations/:locationId/onboarding-status",
    async (request) => getOnboardingStatus(request.params.tenantId, request.params.locationId),
  );

  app.get<{ Params: { tenantId: string; locationId: string } }>(
    "/api/admin/tenants/:tenantId/locations/:locationId/users",
    async (request) => ({ data: await listLocationUsers(request.params.tenantId, request.params.locationId) }),
  );

  app.post<{ Params: { tenantId: string; locationId: string }; Body: TenantLocationUserCreateRequest }>(
    "/api/admin/tenants/:tenantId/locations/:locationId/users",
    async (request, reply) =>
      reply.code(201).send(await createLocationUser(request.params.tenantId, request.params.locationId, request.body)),
  );

  app.patch<{
    Params: { tenantId: string; locationId: string; userId: string };
    Body: TenantLocationUserUpdateRequest;
  }>(
    "/api/admin/tenants/:tenantId/locations/:locationId/users/:userId",
    async (request) => updateLocationUser(request.params.tenantId, request.params.locationId, request.params.userId, request.body),
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

  app.delete<{
    Params: { tenantId: string; locationId: string; stationId: string };
  }>(
    "/api/admin/tenants/:tenantId/locations/:locationId/output-stations/:stationId",
    async (request, reply) => {
      await deleteOutputStation(request.params.tenantId, request.params.locationId, request.params.stationId);
      return reply.code(204).send();
    },
  );
}
