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
      const { order, table, kdsTicketsCreated, kdsTicketsUpdated, printJobsCreated, printJobsUpdated } =
        createOrderSnapshot(request.body.request);

      broadcast("ORDER_CREATED", { order });
      for (const ticket of kdsTicketsCreated) {
        broadcast("KDS_TICKET_CREATED", { ticket });
      }
      for (const ticket of kdsTicketsUpdated) {
        broadcast("KDS_TICKET_UPDATED", { ticket });
      }
      for (const job of printJobsCreated) {
        broadcast("PRINT_JOB_CREATED", { job });
      }
      for (const job of printJobsUpdated) {
        broadcast("PRINT_JOB_UPDATED", { job });
      }
      broadcast("KDS_TICKETS_REBUILT", { order });
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
      if (table) {
        broadcast("TABLE_UPDATED", { table });
      }

      return reply.code(201).send(payment);
    }
  );
}
