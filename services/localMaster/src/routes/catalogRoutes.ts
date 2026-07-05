import type { FastifyInstance } from "fastify";

import { getRelayRuntimeBinding } from "../cloudBinding.js";
import { broadcast } from "../realtime.js";
import { pushCatalogToRelay } from "../relayCatalogSync.js";
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
  listCatalogOutputStations,
  listCatalogTaxes,
  updateCatalogCategory,
  updateCatalogProduct,
  updateCatalogTax
} from "../catalogStore.js";
import { listProductVariantGroups, listProducts } from "../store.js";
import type {
  CatalogCategoryCreateRequest,
  CatalogCategoryUpdateRequest,
  CatalogProductCreateRequest,
  CatalogProductUpdateRequest,
  CatalogTaxCreateRequest,
  CatalogTaxUpdateRequest
} from "../types.js";

export async function registerCatalogRoutes(app: FastifyInstance) {
  app.get("/api/catalog", async () => ({ data: listProducts() }));
  app.get("/api/products", async () => ({ data: listProducts() }));

  app.get("/api/catalog/categories", async () => ({ data: listCatalogCategories() }));
  app.get("/api/catalog/output-stations", async () => ({ data: listCatalogOutputStations() }));
  app.post<{ Body: CatalogCategoryCreateRequest }>("/api/catalog/categories", async (request, reply) => {
    const category = createCatalogCategory(request.body);
    broadcastCatalogUpdated("CATEGORY_CREATED", category);
    return reply.code(201).send(category);
  });
  app.patch<{ Params: { categoryId: string }; Body: CatalogCategoryUpdateRequest }>(
    "/api/catalog/categories/:categoryId",
    async (request) => {
      const category = updateCatalogCategory(request.params.categoryId, request.body);
      broadcastCatalogUpdated("CATEGORY_UPDATED", category);
      return category;
    }
  );
  app.delete<{ Params: { categoryId: string } }>(
    "/api/catalog/categories/:categoryId",
    async (request, reply) => {
      deleteCatalogCategory(request.params.categoryId);
      broadcastCatalogUpdated("CATEGORY_DELETED", { id: request.params.categoryId });
      return reply.code(204).send();
    }
  );
  app.post<{ Params: { categoryId: string } }>(
    "/api/catalog/categories/:categoryId/duplicate",
    async (request, reply) => {
      const category = duplicateCatalogCategory(request.params.categoryId);
      broadcastCatalogUpdated("CATEGORY_CREATED", category);
      return reply.code(201).send(category);
    }
  );

  app.get("/api/catalog/taxes", async () => ({ data: listCatalogTaxes() }));
  app.post<{ Body: CatalogTaxCreateRequest }>("/api/catalog/taxes", async (request, reply) => {
    const tax = createCatalogTax(request.body);
    broadcastCatalogUpdated("TAX_CREATED", tax);
    return reply.code(201).send(tax);
  });
  app.patch<{ Params: { taxId: string }; Body: CatalogTaxUpdateRequest }>(
    "/api/catalog/taxes/:taxId",
    async (request) => {
      const tax = updateCatalogTax(request.params.taxId, request.body);
      broadcastCatalogUpdated("TAX_UPDATED", tax);
      return tax;
    }
  );
  app.delete<{ Params: { taxId: string } }>(
    "/api/catalog/taxes/:taxId",
    async (request, reply) => {
      deleteCatalogTax(request.params.taxId);
      broadcastCatalogUpdated("TAX_DELETED", { id: request.params.taxId });
      return reply.code(204).send();
    }
  );
  app.post<{ Params: { taxId: string } }>(
    "/api/catalog/taxes/:taxId/duplicate",
    async (request, reply) => {
      const tax = duplicateCatalogTax(request.params.taxId);
      broadcastCatalogUpdated("TAX_CREATED", tax);
      return reply.code(201).send(tax);
    }
  );

  app.post<{ Body: CatalogProductCreateRequest }>("/api/catalog/products", async (request, reply) => {
    const product = createCatalogProduct(request.body);
    broadcastCatalogUpdated("PRODUCT_CREATED", product);
    return reply.code(201).send(product);
  });
  app.patch<{ Params: { productId: string }; Body: CatalogProductUpdateRequest }>(
    "/api/catalog/products/:productId",
    async (request) => {
      const product = updateCatalogProduct(request.params.productId, request.body);
      broadcastCatalogUpdated("PRODUCT_UPDATED", product);
      return product;
    }
  );
  app.delete<{ Params: { productId: string } }>(
    "/api/catalog/products/:productId",
    async (request, reply) => {
      deleteCatalogProduct(request.params.productId);
      broadcastCatalogUpdated("PRODUCT_DELETED", { id: request.params.productId });
      return reply.code(204).send();
    }
  );
  app.post<{ Params: { productId: string } }>(
    "/api/catalog/products/:productId/duplicate",
    async (request, reply) => {
      const product = duplicateCatalogProduct(request.params.productId);
      broadcastCatalogUpdated("PRODUCT_CREATED", product);
      return reply.code(201).send(product);
    }
  );

  app.get<{ Params: { productId: string } }>(
    "/api/product-variant-groups/:productId",
    async (request) => ({ data: listProductVariantGroups(request.params.productId) })
  );
}

function broadcastCatalogUpdated(action: string, entity: unknown) {
  broadcast("CATALOG_UPDATED", { action, entity });
  const binding = getRelayRuntimeBinding();
  if (binding) {
    void pushCatalogToRelay(binding);
  }
}
