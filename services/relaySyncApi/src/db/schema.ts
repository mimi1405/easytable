import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
  name: text("display_name").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  passwordHash: text("password_hash"),
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

export const tenantUserLocations = pgTable("tenant_user_locations", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pinHash: text("pin_hash"),
  isActive: integer("is_active").notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_tenant_user_locations_unique").on(table.tenantId, table.locationId, table.userId),
  index("idx_tenant_user_locations_location").on(table.tenantId, table.locationId, table.isActive),
]);

export const locations = pgTable("locations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  address: text("address"),
  localMasterInstanceId: text("local_master_instance_id"),
  serviceMode: text("service_mode").notNull().default("TABLE_SERVICE"),
  status: text("status").notNull().default("ACTIVE"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_locations_tenant_slug").on(table.tenantId, table.slug),
  index("idx_locations_tenant").on(table.tenantId, table.status),
  uniqueIndex("idx_locations_local_master_instance").on(table.localMasterInstanceId),
]);

export const localMasterPairingSessions = pgTable("local_master_pairing_sessions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  setupCodeHash: text("setup_code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  localMasterInstanceId: text("local_master_instance_id"),
  localMasterUrl: text("local_master_url"),
  pairingResultJson: jsonb("pairing_result_json"),
  ...timestamps,
}, (table) => [
  index("idx_local_master_pairing_sessions_location").on(table.tenantId, table.locationId, table.expiresAt),
  uniqueIndex("idx_local_master_pairing_sessions_code_hash").on(table.setupCodeHash),
]);

export const localMasterCredentials = pgTable("local_master_credentials", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  localMasterInstanceId: text("local_master_instance_id").notNull(),
  tokenDigest: text("token_digest").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_local_master_credentials_token").on(table.tokenDigest),
  index("idx_local_master_credentials_instance").on(table.tenantId, table.locationId, table.localMasterInstanceId, table.revokedAt),
]);

export const layoutFloors = pgTable("layout_floors", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  ...timestamps,
}, (table) => [
  index("idx_layout_floors_location").on(table.tenantId, table.locationId, table.sortOrder, table.name),
  uniqueIndex("idx_layout_floors_location_name").on(table.tenantId, table.locationId, table.name),
]);

export const layoutAreas = pgTable("layout_areas", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  floorId: text("floor_id").notNull().references(() => layoutFloors.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  ...timestamps,
}, (table) => [
  index("idx_layout_areas_floor").on(table.tenantId, table.locationId, table.floorId, table.sortOrder, table.name),
  uniqueIndex("idx_layout_areas_floor_name").on(table.tenantId, table.locationId, table.floorId, table.name),
]);

export const layoutTables = pgTable("layout_tables", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  areaId: text("area_id").notNull().references(() => layoutAreas.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  seats: integer("seats").notNull(),
  sortOrder: integer("sort_order").notNull(),
  ...timestamps,
}, (table) => [
  index("idx_layout_tables_area").on(table.tenantId, table.locationId, table.areaId, table.sortOrder, table.name),
  uniqueIndex("idx_layout_tables_area_name").on(table.tenantId, table.locationId, table.areaId, table.name),
]);

export const catalogCategories = pgTable("catalog_categories", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").references(() => locations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  defaultStationId: text("default_station_id"),
  ...timestamps,
}, (table) => [
  index("idx_catalog_categories_tenant").on(table.tenantId, table.sortOrder),
  index("idx_catalog_categories_location").on(table.tenantId, table.locationId, table.sortOrder),
]);

export const catalogTaxes = pgTable("catalog_taxes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").references(() => locations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rateBps: integer("rate_bps").notNull(),
  sortOrder: integer("sort_order").notNull(),
  ...timestamps,
}, (table) => [
  index("idx_catalog_taxes_tenant").on(table.tenantId, table.sortOrder),
  index("idx_catalog_taxes_location").on(table.tenantId, table.locationId, table.sortOrder),
]);

export const catalogOutputStations = pgTable("catalog_output_stations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").references(() => locations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  hasKds: integer("has_kds").notNull().default(0),
  hasPrinter: integer("has_printer").notNull().default(0),
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
  locationId: text("location_id").references(() => locations.id, { onDelete: "cascade" }),
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
  index("idx_catalog_products_location_category").on(table.tenantId, table.locationId, table.categoryId, table.name),
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

export const stationPickups = pgTable("station_pickups", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull(),
  orderId: text("order_id").notNull(),
  orderNumber: text("order_number").notNull(),
  tableId: text("table_id").notNull(),
  tableName: text("table_name").notNull(),
  station: text("station").notNull(),
  status: text("status").notNull(),
  itemsJson: jsonb("items_json").notNull(),
  readyAt: timestamp("ready_at", { withTimezone: true }).notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("idx_station_pickups_location_status").on(table.tenantId, table.locationId, table.status, table.readyAt),
]);

export const kdsTickets = pgTable("kds_tickets", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  locationId: text("location_id").notNull(),
  orderId: text("order_id").notNull(),
  orderNumber: text("order_number").notNull(),
  tableId: text("table_id").notNull(),
  tableName: text("table_name").notNull(),
  station: text("station").notNull(),
  status: text("status").notNull(),
  itemsJson: jsonb("items_json").notNull(),
  doneAt: timestamp("done_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("idx_kds_tickets_location_station").on(table.tenantId, table.locationId, table.station, table.status, table.createdAt),
]);

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

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("idx_sessions_token").on(table.token)
]);

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});
