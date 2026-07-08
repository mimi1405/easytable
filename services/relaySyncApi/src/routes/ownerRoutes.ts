import type { FastifyInstance } from "fastify";

import { createOwnerCatalogCommand, getOwnerCatalog } from "../store/catalogRelayStore.js";
import {
  archiveOwnerLocationUser,
  createOwnerLocationUser,
  deleteOwnerLocationUser,
  listOwnerLocationUsers,
  resetOwnerLocationUserPassword,
  resetOwnerLocationUserPin,
  updateOwnerLocationUser
} from "../store/userStore.js";
import type {
  OwnerCatalogCommandRequest,
  TenantLocationUserCreateRequest,
  TenantLocationUserResetPasswordRequest,
  TenantLocationUserResetPinRequest,
  TenantLocationUserUpdateRequest
} from "../types.js";

export async function registerOwnerRoutes(app: FastifyInstance) {
  app.get<{ Params: { locationId: string } }>("/api/owner/locations/:locationId/catalog", async (request) =>
    getOwnerCatalog(request.headers, request.params.locationId)
  );

  app.post<{ Params: { locationId: string }; Body: OwnerCatalogCommandRequest }>(
    "/api/owner/locations/:locationId/catalog/commands",
    async (request, reply) =>
      reply.code(202).send(await createOwnerCatalogCommand(request.headers, request.params.locationId, request.body))
  );

  app.get<{ Params: { locationId: string } }>("/api/owner/locations/:locationId/users", async (request) => ({
    data: await listOwnerLocationUsers(request.headers, request.params.locationId)
  }));

  app.post<{ Params: { locationId: string }; Body: TenantLocationUserCreateRequest }>(
    "/api/owner/locations/:locationId/users",
    async (request, reply) =>
      reply.code(201).send(await createOwnerLocationUser(request.headers, request.params.locationId, request.body))
  );

  app.patch<{
    Params: { locationId: string; userId: string };
    Body: TenantLocationUserUpdateRequest;
  }>(
    "/api/owner/locations/:locationId/users/:userId",
    async (request) =>
      updateOwnerLocationUser(request.headers, request.params.locationId, request.params.userId, request.body)
  );

  app.post<{
    Params: { locationId: string; userId: string };
    Body: TenantLocationUserResetPasswordRequest;
  }>(
    "/api/owner/locations/:locationId/users/:userId/reset-password",
    async (request) =>
      resetOwnerLocationUserPassword(request.headers, request.params.locationId, request.params.userId, request.body ?? {})
  );

  app.post<{
    Params: { locationId: string; userId: string };
    Body: TenantLocationUserResetPinRequest;
  }>(
    "/api/owner/locations/:locationId/users/:userId/reset-pin",
    async (request) =>
      resetOwnerLocationUserPin(request.headers, request.params.locationId, request.params.userId, request.body ?? {})
  );

  app.post<{ Params: { locationId: string; userId: string } }>(
    "/api/owner/locations/:locationId/users/:userId/archive",
    async (request) =>
      archiveOwnerLocationUser(request.headers, request.params.locationId, request.params.userId)
  );

  app.delete<{ Params: { locationId: string; userId: string } }>(
    "/api/owner/locations/:locationId/users/:userId",
    async (request, reply) => {
      await deleteOwnerLocationUser(request.headers, request.params.locationId, request.params.userId);
      return reply.code(204).send();
    }
  );
}
