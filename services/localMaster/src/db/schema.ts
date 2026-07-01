import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const localState = sqliteTable("local_state", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    orderNumber: text("order_number").notNull().unique(),
    tenantId: text("tenant_id").notNull(),
    locationId: text("location_id").notNull(),
    floorId: text("floor_id").notNull(),
    areaId: text("area_id").notNull(),
    tableId: text("table_id"),
    tableName: text("table_name"),
    serviceMode: text("service_mode").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull(),
    subtotal: integer("subtotal").notNull(),
    taxTotal: integer("tax_total").notNull(),
    total: integer("total").notNull(),
    paymentStatus: text("payment_status").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    closedAt: integer("closed_at")
  },
  (table) => [
    index("idx_orders_open_table").on(table.tableId, table.serviceMode, table.status, table.paymentStatus, table.createdAt)
  ]
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
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
    createdAt: integer("created_at").notNull()
  },
  (table) => [index("idx_order_items_order").on(table.orderId, table.createdAt)]
);

export const orderItemVariantSnapshots = sqliteTable(
  "order_item_variant_snapshots",
  {
    id: text("id").primaryKey(),
    orderItemId: text("order_item_id").notNull().references(() => orderItems.id, { onDelete: "cascade" }),
    variantGroupId: text("variant_group_id"),
    variantGroupName: text("variant_group_name").notNull(),
    variantItemId: text("variant_item_id"),
    variantItemName: text("variant_item_name").notNull(),
    priceDelta: integer("price_delta").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => [index("idx_order_item_variants_item").on(table.orderItemId, table.createdAt)]
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    receivedCash: integer("received_cash"),
    changeGiven: integer("change_given"),
    method: text("method").notNull(),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    providerTransactionId: text("provider_transaction_id"),
    providerStatus: text("provider_status").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => [index("idx_payments_day_close").on(table.status, table.method, table.createdAt)]
);

export const dayCloses = sqliteTable("day_closes", {
  id: text("id").primaryKey(),
  date: text("date").notNull().unique(),
  totalCash: integer("total_cash").notNull(),
  totalCard: integer("total_card").notNull(),
  orderCount: integer("order_count").notNull(),
  itemCount: integer("item_count").notNull(),
  reportJson: text("report_json").notNull(),
  createdAt: integer("created_at").notNull()
});

export const catalogCategories = sqliteTable("catalog_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const catalogTaxes = sqliteTable(
  "catalog_taxes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    rateBps: integer("rate_bps").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [index("idx_catalog_taxes_rate").on(table.rateBps, table.name)]
);

export const catalogProducts = sqliteTable(
  "catalog_products",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id").notNull().references(() => catalogCategories.id, { onDelete: "restrict" }),
    taxId: text("tax_id"),
    productType: text("product_type").notNull(),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    taxCodeId: text("tax_code_id").notNull(),
    taxCodeName: text("tax_code_name").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull(),
    isAvailable: integer("is_available").notNull(),
    station: text("station").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_catalog_products_category").on(table.categoryId, table.name),
    index("idx_catalog_products_station").on(table.station, table.productType),
    index("idx_catalog_products_tax").on(table.taxId, table.name)
  ]
);

export const pairingSessions = sqliteTable(
  "pairing_sessions",
  {
    code: text("code").primaryKey(),
    instanceId: text("instance_id").notNull(),
    displayUrl: text("display_url"),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull()
  },
  (table) => [index("idx_pairing_sessions_expires").on(table.expiresAt, table.usedAt)]
);

export const pairedTerminals = sqliteTable(
  "paired_terminals",
  {
    id: text("id").primaryKey(),
    instanceId: text("instance_id").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    secret: text("secret").notNull(),
    deviceFingerprint: text("device_fingerprint"),
    pairedAt: integer("paired_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull()
  },
  (table) => [index("idx_paired_terminals_seen").on(table.lastSeenAt)]
);
