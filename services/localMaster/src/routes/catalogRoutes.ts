import type { FastifyInstance } from "fastify";

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

  app.get<{ Params: { productId: string } }>(
    "/api/product-variant-groups/:productId",
    async (request) => ({ data: listProductVariantGroups(request.params.productId) })
  );
}
