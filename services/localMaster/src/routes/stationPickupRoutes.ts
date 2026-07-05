import type { FastifyInstance } from "fastify";

import { getRelayRuntimeBinding } from "../cloudBinding.js";
import { pushOperationsToRelay } from "../relayOperationsSync.js";
import { broadcast } from "../realtime.js";
import { createStationPickupSchema } from "../schemas.js";
import {
  acknowledgeStationPickup,
  createStationPickup,
  listStationPickups
} from "../store.js";
import type {
  CreateStationPickupRequest,
  StationPickupStatus
} from "../types.js";
import type { PosRequestBody } from "./types.js";

export async function registerStationPickupRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: StationPickupStatus | "ALL" } }>(
    "/api/station-pickups",
    async (request) => ({
      data: listStationPickups(request.query.status ?? "READY")
    })
  );

  app.post<{ Body: PosRequestBody<CreateStationPickupRequest> }>(
    "/api/station-pickups",
    { schema: createStationPickupSchema },
    async (request, reply) => {
      const pickup = createStationPickup(request.body.request);

      broadcast("STATION_PICKUP_READY", { pickup });
      pushOperationsToRelayIfPaired();

      return reply.code(201).send(pickup);
    }
  );

  app.post<{ Params: { pickupId: string } }>(
    "/api/station-pickups/:pickupId/acknowledge",
    async (request) => {
      const pickup = acknowledgeStationPickup(request.params.pickupId);

      broadcast("STATION_PICKUP_ACKNOWLEDGED", { pickup });
      pushOperationsToRelayIfPaired();

      return pickup;
    }
  );
}

function pushOperationsToRelayIfPaired() {
  const binding = getRelayRuntimeBinding();
  if (binding) {
    void pushOperationsToRelay(binding);
  }
}
