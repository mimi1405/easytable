import type { FastifyInstance } from "fastify";

import { getRelayRuntimeBinding } from "../cloudBinding.js";
import { broadcast } from "../realtime.js";
import { pushOperationsToRelay } from "../relayOperationsSync.js";
import { updateKdsTicketStatusSchema } from "../schemas.js";
import { listKdsTickets, updateKdsTicketStatus } from "../store.js";
import type { UpdateKdsTicketStatusRequest } from "../types.js";
import type { PosRequestBody } from "./types.js";

export async function registerKdsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { station?: string } }>("/api/kds-tickets", async (request) => ({
    data: listKdsTickets(request.query.station)
  }));

  app.post<{ Params: { ticketId: string }; Body: PosRequestBody<UpdateKdsTicketStatusRequest> }>(
    "/api/kds-tickets/:ticketId/status",
    { schema: updateKdsTicketStatusSchema },
    async (request) => {
      const { ticket, pickup } = updateKdsTicketStatus(request.params.ticketId, request.body.request.status);

      broadcast("KDS_TICKET_UPDATED", { ticket });

      if (pickup) {
        broadcast("STATION_PICKUP_READY", { pickup });
      }

      await pushOperationsToRelayIfPaired();

      return ticket;
    }
  );
}

async function pushOperationsToRelayIfPaired() {
  const binding = getRelayRuntimeBinding();
  if (binding) {
    await pushOperationsToRelay(binding);
  }
}
