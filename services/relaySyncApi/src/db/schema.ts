import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const tenantStatus = pgEnum("tenant_status", ["ACTIVE", "SUSPENDED"]);
export const userStatus = pgEnum("user_status", ["ACTIVE", "INVITED", "DISABLED"]);
export const relayCommandStatus = pgEnum("relay_command_status", ["pending", "delivered", "accepted", "failed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  status: tenantStatus("status").notNull().default("ACTIVE"),
  ...timestamps,
}, (table) => [uniqueIndex("idx_tenants_slug").on(table.slug)]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  status: userStatus("status").notNull().default("INVITED"),
  ...timestamps,
}, (table) => [uniqueIndex("idx_users_email").on(table.email)]);

export const tenantUsers = pgTable("tenant_users", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_tenant_users_unique").on(table.tenantId, table.userId),
  index("idx_tenant_users_tenant").on(table.tenantId, table.role),
]);

export const locations = pgTable("locations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  address: text("address"),
  localMasterInstanceId: text("local_master_instance_id"),
  status: text("status").notNull().default("ACTIVE"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_locations_tenant_slug").on(table.tenantId, table.slug),
  index("idx_locations_tenant").on(table.tenantId, table.status),
]);

export const catalogCategories = pgTable("catalog_categories", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  ...timestamps,
}, (table) => [index("idx_catalog_categories_tenant").on(table.tenantId, table.sortOrder)]);

export const catalogTaxes = pgTable("catalog_taxes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rateBps: integer("rate_bps").notNull(),
  sortOrder: integer("sort_order").notNull(),
  ...timestamps,
}, (table) => [index("idx_catalog_taxes_tenant").on(table.tenantId, table.sortOrder)]);

export const catalogOutputStations = pgTable("catalog_output_stations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").references(() => locations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  isActive: integer("is_active").notNull(),
  sortOrder: integer("sort_order").notNull(),
  ...timestamps,
}, (table) => [
  index("idx_catalog_output_stations_tenant").on(table.tenantId, table.isActive, table.sortOrder),
  index("idx_catalog_output_stations_location").on(table.tenantId, table.locationId, table.isActive, table.sortOrder),
]);

export const catalogProducts = pgTable("catalog_products", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  categoryId: text("category_id").notNull(),
  taxId: text("tax_id"),
  productType: text("product_type").notNull(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  taxCodeId: text("tax_code_id").notNull(),
  taxCodeName: text("tax_code_name").notNull(),
  taxRateBps: integer("tax_rate_bps").notNull(),
  isAvailable: integer("is_available").notNull(),
  stationId: text("station_id"),
  ...timestamps,
}, (table) => [
  index("idx_catalog_products_tenant_category").on(table.tenantId, table.categoryId, table.name),
  index("idx_catalog_products_tenant_station").on(table.tenantId, table.stationId, table.productType),
]);

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull(),
  localMasterInstanceId: text("local_master_instance_id").notNull(),
  orderNumber: text("order_number").notNull(),
  serviceMode: text("service_mode").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  subtotal: integer("subtotal").notNull(),
  taxTotal: integer("tax_total").notNull(),
  total: integer("total").notNull(),
  paymentStatus: text("payment_status").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("idx_orders_tenant_location").on(table.tenantId, table.locationId, table.openedAt)]);

export const orderItems = pgTable("order_items", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: text("product_id"),
  productType: text("product_type").notNull(),
  productName: text("product_name").notNull(),
  productCategory: text("product_category").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  taxCodeId: text("tax_code_id"),
  taxCodeName: text("tax_code_name").notNull(),
  taxRateBps: integer("tax_rate_bps").notNull(),
  taxAmount: integer("tax_amount").notNull(),
  totalPrice: integer("total_price").notNull(),
  station: text("station"),
  notes: text("notes"),
  ...timestamps,
}, (table) => [index("idx_order_items_order").on(table.tenantId, table.orderId)]);

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  receivedCash: integer("received_cash"),
  changeGiven: integer("change_given"),
  method: text("method").notNull(),
  status: text("status").notNull(),
  provider: text("provider").notNull(),
  providerTransactionId: text("provider_transaction_id"),
  providerStatus: text("provider_status").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => [index("idx_payments_tenant_day_close").on(table.tenantId, table.status, table.method, table.paidAt)]);

export const dayCloses = pgTable("day_closes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull(),
  date: text("date").notNull(),
  totalCash: integer("total_cash").notNull(),
  totalCard: integer("total_card").notNull(),
  orderCount: integer("order_count").notNull(),
  itemCount: integer("item_count").notNull(),
  reportJson: jsonb("report_json").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("idx_day_closes_tenant_location_date").on(table.tenantId, table.locationId, table.date)]);

export const syncBatches = pgTable("sync_batches", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull(),
  localMasterInstanceId: text("local_master_instance_id").notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  ...timestamps,
}, (table) => [index("idx_sync_batches_tenant_location").on(table.tenantId, table.locationId, table.createdAt)]);

export const syncEvents = pgTable("sync_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  batchId: text("batch_id").references(() => syncBatches.id, { onDelete: "set null" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  operation: text("operation").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  ...timestamps,
}, (table) => [index("idx_sync_events_entity").on(table.tenantId, table.entityType, table.entityId)]);

export const relayCommands = pgTable("relay_commands", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull(),
  localMasterInstanceId: text("local_master_instance_id").notNull(),
  type: text("type").notNull(),
  status: relayCommandStatus("status").notNull().default("pending"),
  payloadJson: jsonb("payload_json").notNull(),
  resultJson: jsonb("result_json"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("idx_relay_commands_pending").on(table.tenantId, table.locationId, table.status, table.createdAt)]);
