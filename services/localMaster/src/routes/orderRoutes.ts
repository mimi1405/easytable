import type { FastifyInstance } from "fastify";

import { broadcast } from "../realtime.js";
import { completeMockPaymentSchema, createOrderSchema, createOrderSnapshotSchema } from "../schemas.js";
import {
  completeMockPayment,
  createOrder,
  createOrderSnapshot,
  listOpenOrders
} from "../store.js";
import type {
  CompleteMockPaymentRequest,
  CreateOrderSnapshotRequest,
  OrderDraft
} from "../types.js";
import type { PosRequestBody } from "./types.js";

export async function registerOrderRoutes(app: FastifyInstance) {
  app.get("/api/orders/open", async () => ({ data: listOpenOrders() }));

  app.post<{ Body: OrderDraft }>("/api/orders", { schema: createOrderSchema }, async (request, reply) => {
    const { order, table } = createOrder(request.body);

    broadcast("ORDER_CREATED", { order });
    broadcast("TABLE_UPDATED", { table });

    return reply.code(201).send({ success: true, order });
  });

  app.post<{ Body: PosRequestBody<CreateOrderSnapshotRequest> }>(
    "/api/order-snapshots",
    { schema: createOrderSnapshotSchema },
    async (request, reply) => {
      const { order, table } = createOrderSnapshot(request.body.request);

      broadcast("ORDER_CREATED", { order });
      broadcast("TABLE_UPDATED", { table });

      return reply.code(201).send(order);
    }
  );

  app.post<{ Body: PosRequestBody<CompleteMockPaymentRequest> }>(
    "/api/mock-payments/complete",
    { schema: completeMockPaymentSchema },
    async (request, reply) => {
      const { payment, table } = completeMockPayment(request.body.request);

      broadcast("PAYMENT_COMPLETED", { payment });
      broadcast("TABLE_UPDATED", { table });

      return reply.code(201).send(payment);
    }
  );
}
