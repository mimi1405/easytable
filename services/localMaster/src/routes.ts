import type { FastifyInstance } from "fastify";

import {
  completeMockPaymentSchema,
  createPairingSessionSchema,
  currentBusinessDateSchema,
  dayClosePreviewSchema,
  pairTerminalSchema,
  createOrderSchema,
  createOrderSnapshotSchema,
  saveDayCloseSchema,
  terminalHeartbeatSchema
} from "./schemas.js";
import {
  createPairingSession,
  getLocalMasterIdentity,
  pairTerminal,
  recordTerminalHeartbeat
} from "./pairing.js";
import {
  createCatalogCategory,
  createCatalogProduct,
  createCatalogTax,
  deleteCatalogCategory,
  deleteCatalogProduct,
  deleteCatalogTax,
  duplicateCatalogCategory,
  duplicateCatalogProduct,
  duplicateCatalogTax,
  listCatalogCategories,
  listCatalogTaxes,
  updateCatalogCategory,
  updateCatalogTax,
  updateCatalogProduct
} from "./catalogStore.js";
import {
  completeMockPayment,
  getCurrentBusinessDate,
  getDayClosePreview,
  createOrder,
  createOrderSnapshot,
  getOpenTableOrderBasket,
  getTableLayout,
  listOpenOrders,
  listProductVariantGroups,
  listProducts,
  listTables,
  loadPosSettings,
  saveDayClose
} from "./store.js";
import type {
  CatalogCategoryCreateRequest,
  CatalogCategoryUpdateRequest,
  CatalogProductCreateRequest,
  CatalogProductUpdateRequest,
  CatalogTaxCreateRequest,
  CatalogTaxUpdateRequest,
  CompleteMockPaymentRequest,
  CurrentBusinessDateRequest,
  DayClosePreviewRequest,
  CreateOrderSnapshotRequest,
  SaveDayCloseRequest,
  OrderDraft,
  PairTerminalRequest,
  PairingSessionRequest,
  TerminalHeartbeatRequest
} from "./types.js";
import { broadcast, connectedClientCount } from "./realtime.js";

type PosRequestBody<TRequest> = {
  request: TRequest;
};

export async function registerApiRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    ...getLocalMasterIdentity(),
    clients: connectedClientCount(),
    orders: listOpenOrders().length
  }));

  app.get("/api/local-master/identity", async () => ({
    ...getLocalMasterIdentity(),
    clients: connectedClientCount(),
    orders: listOpenOrders().length
  }));

  app.post<{ Body: PosRequestBody<PairingSessionRequest> }>(
    "/api/local-master/pairing-sessions",
    { schema: createPairingSessionSchema },
    async (request, reply) => reply.code(201).send(createPairingSession(request.body.request))
  );

  app.post<{ Body: PosRequestBody<PairTerminalRequest> }>(
    "/api/local-master/pair",
    { schema: pairTerminalSchema },
    async (request, reply) => reply.code(201).send(pairTerminal(request.body.request))
  );

  app.post<{ Params: { terminalId: string }; Body: PosRequestBody<TerminalHeartbeatRequest> }>(
    "/api/local-master/terminals/:terminalId/heartbeat",
    { schema: terminalHeartbeatSchema },
    async (request) => recordTerminalHeartbeat(request.params.terminalId, request.body.request)
  );

  app.get("/api/catalog", async () => ({ data: listProducts() }));

  app.get("/api/products", async () => ({ data: listProducts() }));

  app.get("/api/catalog/categories", async () => ({ data: listCatalogCategories() }));

  app.get("/api/catalog/taxes", async () => ({ data: listCatalogTaxes() }));

  app.post<{ Body: CatalogTaxCreateRequest }>("/api/catalog/taxes", async (request, reply) =>
    reply.code(201).send(createCatalogTax(request.body))
  );

  app.patch<{ Params: { taxId: string }; Body: CatalogTaxUpdateRequest }>(
    "/api/catalog/taxes/:taxId",
    async (request) => updateCatalogTax(request.params.taxId, request.body)
  );

  app.delete<{ Params: { taxId: string } }>(
    "/api/catalog/taxes/:taxId",
    async (request, reply) => {
      deleteCatalogTax(request.params.taxId);
      return reply.code(204).send();
    }
  );

  app.post<{ Params: { taxId: string } }>(
    "/api/catalog/taxes/:taxId/duplicate",
    async (request, reply) => reply.code(201).send(duplicateCatalogTax(request.params.taxId))
  );

  app.post<{ Body: CatalogProductCreateRequest }>("/api/catalog/products", async (request, reply) =>
    reply.code(201).send(createCatalogProduct(request.body))
  );

  app.patch<{ Params: { productId: string }; Body: CatalogProductUpdateRequest }>(
    "/api/catalog/products/:productId",
    async (request) => updateCatalogProduct(request.params.productId, request.body)
  );

  app.delete<{ Params: { productId: string } }>(
    "/api/catalog/products/:productId",
    async (request, reply) => {
      deleteCatalogProduct(request.params.productId);
      return reply.code(204).send();
    }
  );

  app.post<{ Params: { productId: string } }>(
    "/api/catalog/products/:productId/duplicate",
    async (request, reply) => reply.code(201).send(duplicateCatalogProduct(request.params.productId))
  );

  app.post<{ Body: CatalogCategoryCreateRequest }>("/api/catalog/categories", async (request, reply) =>
    reply.code(201).send(createCatalogCategory(request.body))
  );

  app.patch<{ Params: { categoryId: string }; Body: CatalogCategoryUpdateRequest }>(
    "/api/catalog/categories/:categoryId",
    async (request) => updateCatalogCategory(request.params.categoryId, request.body)
  );

  app.delete<{ Params: { categoryId: string } }>(
    "/api/catalog/categories/:categoryId",
    async (request, reply) => {
      deleteCatalogCategory(request.params.categoryId);
      return reply.code(204).send();
    }
  );

  app.post<{ Params: { categoryId: string } }>(
    "/api/catalog/categories/:categoryId/duplicate",
    async (request, reply) => reply.code(201).send(duplicateCatalogCategory(request.params.categoryId))
  );

  app.get<{ Params: { productId: string } }>(
    "/api/product-variant-groups/:productId",
    async (request) => ({ data: listProductVariantGroups(request.params.productId) })
  );

  app.get("/api/tables", async () => ({ data: listTables() }));

  app.get("/api/table-layout", async () => getTableLayout());

  app.get<{ Params: { tableId: string } }>(
    "/api/tables/:tableId/open-basket",
    async (request) => getOpenTableOrderBasket(request.params.tableId)
  );

  app.get("/api/orders/open", async () => ({ data: listOpenOrders() }));
  app.get("/api/pos-settings", async () => loadPosSettings());

  app.post<{ Body: PosRequestBody<CurrentBusinessDateRequest> }>(
    "/api/business-date/current",
    { schema: currentBusinessDateSchema },
    async (request) => getCurrentBusinessDate(request.body.request)
  );

  app.post<{ Body: PosRequestBody<DayClosePreviewRequest> }>(
    "/api/day-close/preview",
    { schema: dayClosePreviewSchema },
    async (request) => getDayClosePreview(request.body.request)
  );

  app.post<{ Body: PosRequestBody<SaveDayCloseRequest> }>(
    "/api/day-close",
    { schema: saveDayCloseSchema },
    async (request, reply) => reply.code(201).send(saveDayClose(request.body.request))
  );

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







