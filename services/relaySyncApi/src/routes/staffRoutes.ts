import type { FastifyInstance } from "fastify";

import { openRelayLocationEventStream } from "../lib/realtime.js";
import { getStaffOutputStations, getStaffProducts, getStaffProductVariantGroups } from "../store/catalogRelayStore.js";
import { getRelayOpenTableOrderBasket, listRelayKdsTickets, listRelayStationPickups } from "../store/operationsRelayStore.js";
import { getRelaySalesReport } from "../store/reportingRelayStore.js";
import {
  createKdsTicketStatusRelayCommand,
  createStaffComplimentaryAdjustRelayCommand,
  createStaffOrderRelayCommand,
  createStaffPickupAcknowledgeRelayCommand,
  getStaffRelayCommand,
  requireStaffSession
} from "../store/staffRelayStore.js";
import { getStaffTableLayout } from "../store/tableLayoutStore.js";
import type { StaffComplimentaryAdjustRelayRequest, StaffOrderSnapshotRelayRequest } from "../types.js";

export async function registerStaffRoutes(app: FastifyInstance) {
  app.get<{ Params: { locationId: string } }>("/api/staff/locations/:locationId/realtime", async (request, reply) => {
    const session = await requireStaffSession(request.headers, request.params.locationId);
    return openRelayLocationEventStream(session.tenant_id, request.params.locationId, request, reply);
  });

  app.post<{ Params: { locationId: string }; Body: StaffOrderSnapshotRelayRequest }>(
    "/api/staff/locations/:locationId/order-snapshots",
    async (request, reply) =>
      reply.code(202).send(await createStaffOrderRelayCommand(request.headers, request.params.locationId, request.body))
  );

  app.post<{ Params: { locationId: string; orderId: string }; Body: StaffComplimentaryAdjustRelayRequest }>(
    "/api/staff/locations/:locationId/orders/:orderId/complimentary",
    async (request, reply) => reply.code(202).send(await createStaffComplimentaryAdjustRelayCommand(
      request.headers,
      request.params.locationId,
      request.params.orderId,
      request.body
    ))
  );

  app.get<{ Params: { locationId: string } }>("/api/staff/locations/:locationId/table-layout", async (request) =>
    getStaffTableLayout(request.headers, request.params.locationId)
  );

  app.get<{ Params: { locationId: string }; Querystring: { business_date?: string } }>(
    "/api/staff/locations/:locationId/reporting/sales",
    async (request) => getRelaySalesReport(request.headers, request.params.locationId, request.query.business_date ?? "")
  );

  app.get<{ Params: { locationId: string } }>("/api/staff/locations/:locationId/products", async (request) =>
    ({ data: await getStaffProducts(request.headers, request.params.locationId) })
  );

  app.get<{ Params: { locationId: string } }>("/api/staff/locations/:locationId/output-stations", async (request) =>
    ({ data: await getStaffOutputStations(request.headers, request.params.locationId) })
  );

  app.get<{ Params: { locationId: string; productId: string } }>(
    "/api/staff/locations/:locationId/product-variant-groups/:productId",
    async (request) => ({
      data: await getStaffProductVariantGroups(request.headers, request.params.locationId, request.params.productId)
    })
  );

  app.get<{ Params: { locationId: string; tableId: string } }>(
    "/api/staff/locations/:locationId/tables/:tableId/open-basket",
    async (request) =>
      getRelayOpenTableOrderBasket(request.headers, request.params.locationId, request.params.tableId)
  );

  app.get<{ Params: { locationId: string }; Querystring: { status?: "READY" | "ACKNOWLEDGED" | "ALL" } }>(
    "/api/staff/locations/:locationId/station-pickups",
    async (request) => ({
      data: await listRelayStationPickups(request.headers, request.params.locationId, request.query.status ?? "READY")
    })
  );

  app.post<{ Params: { locationId: string; pickupId: string }; Body: { request_id?: string } }>(
    "/api/staff/locations/:locationId/station-pickups/:pickupId/acknowledge",
    async (request, reply) =>
      reply.code(202).send(await createStaffPickupAcknowledgeRelayCommand(
        request.headers,
        request.params.locationId,
        request.params.pickupId,
        request.body
      ))
  );

  app.get<{ Params: { locationId: string }; Querystring: { station?: string } }>(
    "/api/staff/locations/:locationId/kds-tickets",
    async (request) => ({
      data: await listRelayKdsTickets(request.headers, request.params.locationId, request.query.station)
    })
  );

  app.post<{ Params: { locationId: string; ticketId: string }; Body: { request_id?: string; status?: string } }>(
    "/api/staff/locations/:locationId/kds-tickets/:ticketId/status",
    async (request, reply) =>
      reply.code(202).send(await createKdsTicketStatusRelayCommand(
        request.headers,
        request.params.locationId,
        request.params.ticketId,
        request.body
      ))
  );

  app.get<{ Params: { commandId: string } }>("/api/staff/commands/:commandId", async (request) =>
    getStaffRelayCommand(request.headers, request.params.commandId)
  );
}
