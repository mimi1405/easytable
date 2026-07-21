import type { FastifyInstance } from "fastify";

import { getRelayRuntimeBinding } from "../cloudBinding.js";
import { pushOperationsToRelay } from "../relayOperationsSync.js";
import { broadcast } from "../realtime.js";
import { requireLocalSession } from "../localAuth.js";
import { completePaymentSchema, createOrderSchema, createOrderSnapshotSchema } from "../schemas.js";
import {
  adjustComplimentaryQuantity,
  completeCashPayment,
  completeComplimentaryOrder,
  createOrderStorno,
  createOrder,
  createOrderSnapshot,
  getOrderSnapshot,
  listOpenOrders,
  startWalleeTerminalPayment
} from "../store.js";
import type {
  AdjustComplimentaryQuantityRequest,
  CompleteCashPaymentRequest,
  CompleteComplimentaryOrderRequest,
  CreateOrderStornoRequest,
  CreateOrderSnapshotRequest,
  OrderDraft,
  StartWalleeTerminalPaymentRequest
} from "../types.js";
import type { PosRequestBody } from "./types.js";

export async function registerOrderRoutes(app: FastifyInstance) {
  app.get("/api/orders/open", async () => ({ data: listOpenOrders() }));

  app.get<{ Params: { orderId: string } }>("/api/orders/:orderId/snapshot", async (request) =>
    getOrderSnapshot(request.params.orderId)
  );

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
      const result = createOrderSnapshot(withComplimentaryActor(request.body.request, request.headers.authorization));
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

  app.post<{ Body: PosRequestBody<CompleteCashPaymentRequest> }>(
    "/api/payments/cash/complete",
    { schema: completePaymentSchema },
    async (request, reply) => {
      const result = completeCashPayment(withComplimentaryActor(request.body.request, request.headers.authorization));
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
    { schema: completePaymentSchema },
    async (request, reply) => {
      const result = await startWalleeTerminalPayment(withComplimentaryActor(request.body.request, request.headers.authorization));
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

  app.post<{ Body: PosRequestBody<CompleteComplimentaryOrderRequest> }>(
    "/api/orders/complimentary/complete",
    { schema: completePaymentSchema },
    async (request, reply) => {
      const session = requireLocalSession(request.headers.authorization);
      const body = request.body.request;
      const command = completeComplimentaryOrder({
        ...body,
        actor: {
          user_id: session.user_id,
          display_name: session.display_name,
          role: session.role,
          device_id: session.device_id,
          terminal_id: body.terminal_id?.trim() || null
        }
      });
      if (!command.replayed) {
        broadcast("ORDER_COMPLIMENTARY_COMPLETED", { order: command.result });
        if (command.table) broadcast("TABLE_UPDATED", { table: command.table });
        pushOperationsToRelayIfPaired();
      }
      return reply.code(201).send(command.result);
    }
  );

  app.post<{ Params: { orderId: string }; Body: PosRequestBody<Omit<AdjustComplimentaryQuantityRequest, "order_id" | "actor">> }>(
    "/api/orders/:orderId/complimentary",
    async (request, reply) => {
      const session = requireLocalSession(request.headers.authorization);
      const result = adjustComplimentaryQuantity({
        ...request.body.request,
        order_id: request.params.orderId,
        actor: {
          user_id: session.user_id,
          display_name: session.display_name,
          role: session.role,
          device_id: session.device_id,
          terminal_id: null
        }
      });
      if (!result.replayed) {
        broadcast("ORDER_UPDATED", { order: result });
        pushOperationsToRelayIfPaired();
      }
      return reply.code(200).send(result);
    }
  );

  app.post<{ Params: { orderId: string }; Body: PosRequestBody<CreateOrderStornoRequest> }>(
    "/api/orders/:orderId/stornos",
    async (request, reply) => {
      const result = createOrderStorno(request.params.orderId, request.body.request);
      broadcast("ORDER_STORNO_RECORDED", { storno: result });
      broadcast("PAYMENT_UPDATED", { storno: result });
      pushOperationsToRelayIfPaired();
      return reply.code(201).send(result);
    }
  );
}

function withComplimentaryActor<T extends CreateOrderSnapshotRequest>(request: T, authorization?: string): T {
  if (!request.lines.some((line) => (line.complimentary_quantity ?? 0) > 0)) return request;
  const session = requireLocalSession(authorization);
  const terminalId = "terminal_id" in request && typeof request.terminal_id === "string" ? request.terminal_id : null;
  return {
    ...request,
    actor: {
      user_id: session.user_id,
      display_name: session.display_name,
      role: session.role,
      device_id: session.device_id,
      terminal_id: terminalId
    }
  };
}

function pushOperationsToRelayIfPaired() {
  const binding = getRelayRuntimeBinding();
  if (binding) {
    void pushOperationsToRelay(binding);
  }
}
