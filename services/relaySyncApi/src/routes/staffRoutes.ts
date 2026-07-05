import type { FastifyInstance } from "fastify";

import { getStaffOutputStations, getStaffProducts, getStaffProductVariantGroups } from "../store/catalogRelayStore.js";
import { getRelayOpenTableOrderBasket, listRelayKdsTickets, listRelayStationPickups } from "../store/operationsRelayStore.js";
import {
  createKdsTicketStatusRelayCommand,
  createStaffOrderRelayCommand,
  createStaffPickupAcknowledgeRelayCommand,
  getStaffRelayCommand,
  loginStaff
} from "../store/staffRelayStore.js";
import { getStaffTableLayout } from "../store/tableLayoutStore.js";
import type { StaffLoginRequest, StaffOrderSnapshotRelayRequest } from "../types.js";

export async function registerStaffRoutes(app: FastifyInstance) {
  app.post<{ Body: StaffLoginRequest }>("/api/staff/login", async (request, reply) =>
    reply.code(201).send(await loginStaff(request.body))
  );

  app.post<{ Params: { locationId: string }; Body: StaffOrderSnapshotRelayRequest }>(
    "/api/staff/locations/:locationId/order-snapshots",
    async (request, reply) =>
      reply.code(202).send(await createStaffOrderRelayCommand(request.headers.authorization, request.params.locationId, request.body))
  );

  app.get<{ Params: { locationId: string } }>("/api/staff/locations/:locationId/table-layout", async (request) =>
    getStaffTableLayout(request.headers.authorization, request.params.locationId)
  );

  app.get<{ Params: { locationId: string } }>("/api/staff/locations/:locationId/products", async (request) =>
    ({ data: await getStaffProducts(request.headers.authorization, request.params.locationId) })
  );

  app.get<{ Params: { locationId: string } }>("/api/staff/locations/:locationId/output-stations", async (request) =>
    ({ data: await getStaffOutputStations(request.headers.authorization, request.params.locationId) })
  );

  app.get<{ Params: { locationId: string; productId: string } }>(
    "/api/staff/locations/:locationId/product-variant-groups/:productId",
    async (request) => ({
      data: await getStaffProductVariantGroups(request.headers.authorization, request.params.locationId, request.params.productId)
    })
  );

  app.get<{ Params: { locationId: string; tableId: string } }>(
    "/api/staff/locations/:locationId/tables/:tableId/open-basket",
    async (request) =>
      getRelayOpenTableOrderBasket(request.headers.authorization, request.params.locationId, request.params.tableId)
  );

  app.get<{ Params: { locationId: string }; Querystring: { status?: "READY" | "ACKNOWLEDGED" | "ALL" } }>(
    "/api/staff/locations/:locationId/station-pickups",
    async (request) => ({
      data: await listRelayStationPickups(request.headers.authorization, request.params.locationId, request.query.status ?? "READY")
    })
  );

  app.post<{ Params: { locationId: string; pickupId: string }; Body: { request_id?: string } }>(
    "/api/staff/locations/:locationId/station-pickups/:pickupId/acknowledge",
    async (request, reply) =>
      reply.code(202).send(await createStaffPickupAcknowledgeRelayCommand(
        request.headers.authorization,
        request.params.locationId,
        request.params.pickupId,
        request.body
      ))
  );

  app.get<{ Params: { locationId: string }; Querystring: { station?: string } }>(
    "/api/staff/locations/:locationId/kds-tickets",
    async (request) => ({
      data: await listRelayKdsTickets(request.headers.authorization, request.params.locationId, request.query.station)
    })
  );

  app.post<{ Params: { locationId: string; ticketId: string }; Body: { request_id?: string; status?: string } }>(
    "/api/staff/locations/:locationId/kds-tickets/:ticketId/status",
    async (request, reply) =>
      reply.code(202).send(await createKdsTicketStatusRelayCommand(
        request.headers.authorization,
        request.params.locationId,
        request.params.ticketId,
        request.body
      ))
  );

  app.get<{ Params: { commandId: string } }>("/api/staff/commands/:commandId", async (request) =>
    getStaffRelayCommand(request.headers.authorization, request.params.commandId)
  );
}
