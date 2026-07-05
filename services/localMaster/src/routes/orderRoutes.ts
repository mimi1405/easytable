import type { FastifyInstance } from "fastify";

import { getRelayRuntimeBinding } from "../cloudBinding.js";
import { pushOperationsToRelay } from "../relayOperationsSync.js";
import { broadcast } from "../realtime.js";
import { completeMockPaymentSchema, createOrderSchema, createOrderSnapshotSchema } from "../schemas.js";
import {
  completeMockPayment,
  createOrder,
  createOrderSnapshot,
  listOpenOrders,
  startWalleeTerminalPayment
} from "../store.js";
import type {
  CompleteMockPaymentRequest,
  CreateOrderSnapshotRequest,
  OrderDraft,
  StartWalleeTerminalPaymentRequest
} from "../types.js";
import type { PosRequestBody } from "./types.js";

export async function registerOrderRoutes(app: FastifyInstance) {
  app.get("/api/orders/open", async () => ({ data: listOpenOrders() }));

  app.post<{ Body: OrderDraft }>("/api/orders", { schema: createOrderSchema }, async (request, reply) => {
    const { order, table } = createOrder(request.body);

    broadcast("ORDER_CREATED", { order });
    broadcast("TABLE_UPDATED", { table });
    pushOperationsToRelayIfPaired();

    return reply.code(201).send({ success: true, order });
  });

  app.post<{ Body: PosRequestBody<CreateOrderSnapshotRequest> }>(
    "/api/order-snapshots",
    { schema: createOrderSnapshotSchema },
    async (request, reply) => {
      const result = createOrderSnapshot(request.body.request);
      const { order, table, kdsTicketsCreated, kdsTicketsUpdated, printJobsCreated, printJobsUpdated } = result;

      if (!result.replayed) {
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
        pushOperationsToRelayIfPaired();
      }

      return reply.code(201).send(order);
    }
  );

  app.post<{ Body: PosRequestBody<CompleteMockPaymentRequest> }>(
    "/api/mock-payments/complete",
    { schema: completeMockPaymentSchema },
    async (request, reply) => {
      const result = completeMockPayment(request.body.request);
      const { payment, table } = result;

      if (!result.replayed) {
        broadcast("PAYMENT_UPDATED", { payment });
        if (payment.lifecycle_state === "completed") {
          broadcast("PAYMENT_COMPLETED", { payment });
        }
        if (table) {
          broadcast("TABLE_UPDATED", { table });
        }
        pushOperationsToRelayIfPaired();
      }

      return reply.code(201).send(payment);
    }
  );

  app.post<{ Body: PosRequestBody<StartWalleeTerminalPaymentRequest> }>(
    "/api/payments/wallee-terminal/start",
    { schema: completeMockPaymentSchema },
    async (request, reply) => {
      const result = startWalleeTerminalPayment(request.body.request);
      const { payment, table } = result;

      if (!result.replayed) {
        broadcast("PAYMENT_UPDATED", { payment });
        if (payment.lifecycle_state === "completed") {
          broadcast("PAYMENT_COMPLETED", { payment });
        }
        if (table) {
          broadcast("TABLE_UPDATED", { table });
        }
        pushOperationsToRelayIfPaired();
      }

      return reply.code(payment.lifecycle_state === "completed" ? 201 : 202).send(payment);
    }
  );
}

function pushOperationsToRelayIfPaired() {
  const binding = getRelayRuntimeBinding();
  if (binding) {
    void pushOperationsToRelay(binding);
  }
}
