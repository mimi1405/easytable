import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const localState = sqliteTable("local_state", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("idx_tenants_slug").on(table.slug),
    index("idx_tenants_status").on(table.status, table.name)
  ]
);

export const locations = sqliteTable(
  "locations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    address: text("address"),
    localMasterInstanceId: text("local_master_instance_id"),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("idx_locations_tenant_slug").on(table.tenantId, table.slug),
    index("idx_locations_tenant").on(table.tenantId, table.status, table.name),
    index("idx_locations_local_master").on(table.localMasterInstanceId)
  ]
);

export const layoutFloors = sqliteTable(
  "layout_floors",
  {
    id: text("id").primaryKey(),
    locationId: text("location_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_layout_floors_location").on(table.locationId, table.sortOrder, table.name),
    uniqueIndex("idx_layout_floors_location_name").on(table.locationId, table.name)
  ]
);

export const layoutAreas = sqliteTable(
  "layout_areas",
  {
    id: text("id").primaryKey(),
    floorId: text("floor_id").notNull().references(() => layoutFloors.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_layout_areas_floor").on(table.floorId, table.sortOrder, table.name),
    uniqueIndex("idx_layout_areas_floor_name").on(table.floorId, table.name)
  ]
);

export const layoutTables = sqliteTable(
  "layout_tables",
  {
    id: text("id").primaryKey(),
    areaId: text("area_id").notNull().references(() => layoutAreas.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    seats: integer("seats").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_layout_tables_area").on(table.areaId, table.sortOrder, table.name),
    uniqueIndex("idx_layout_tables_area_name").on(table.areaId, table.name)
  ]
);

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
  defaultStationId: text("default_station_id").references(() => catalogOutputStations.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const catalogOutputStations = sqliteTable(
  "catalog_output_stations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    hasKds: integer("has_kds").notNull().default(0),
    hasPrinter: integer("has_printer").notNull().default(0),
    isActive: integer("is_active").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [index("idx_catalog_output_stations_tenant").on(table.tenantId, table.isActive, table.sortOrder)]
);

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
    station: text("station").notNull().default(""),
    stationId: text("station_id").references(() => catalogOutputStations.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_catalog_products_category").on(table.categoryId, table.name),
    index("idx_catalog_products_station").on(table.stationId, table.productType),
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

export const orderSnapshots = sqliteTable(
  "order_snapshots",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    orderNumber: text("order_number").notNull(),
    snapshotType: text("snapshot_type").notNull(),
    tableContextJson: text("table_context_json"),
    actorJson: text("actor_json"),
    subtotal: integer("subtotal").notNull(),
    taxTotal: integer("tax_total").notNull(),
    total: integer("total").notNull(),
    paymentId: text("payment_id").notNull(),
    paymentRequestId: text("payment_request_id").notNull(),
    paymentMethod: text("payment_method").notNull(),
    paymentAmount: integer("payment_amount").notNull(),
    paymentTerminalId: text("payment_terminal_id"),
    provider: text("provider").notNull(),
    providerTransactionId: text("provider_transaction_id"),
    providerStatus: text("provider_status").notNull(),
    paymentLifecycleState: text("payment_lifecycle_state").notNull(),
    paidAt: integer("paid_at").notNull(),
    terminalId: text("terminal_id"),
    businessDate: text("business_date").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => [
    uniqueIndex("idx_order_snapshots_order").on(table.orderId),
    index("idx_order_snapshots_business_date").on(table.businessDate, table.createdAt),
    index("idx_order_snapshots_payment").on(table.paymentMethod, table.paymentId),
    index("idx_order_snapshots_terminal").on(table.terminalId)
  ]
);

export const orderSnapshotLines = sqliteTable(
  "order_snapshot_lines",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id").notNull().references(() => orderSnapshots.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    lineId: text("line_id").notNull(),
    productId: text("product_id").notNull(),
    productType: text("product_type").notNull(),
    productName: text("product_name").notNull(),
    productCategory: text("product_category").notNull(),
    basePrice: integer("base_price").notNull(),
    taxCodeId: text("tax_code_id").notNull(),
    taxCodeName: text("tax_code_name").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull(),
    station: text("station").notNull(),
    variantsJson: text("variants_json").notNull(),
    unitTotal: integer("unit_total").notNull(),
    quantity: integer("quantity").notNull(),
    complimentaryQuantity: integer("complimentary_quantity").notNull().default(0),
    complimentaryValue: integer("complimentary_value").notNull().default(0),
    lineTotal: integer("line_total").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => [
    uniqueIndex("idx_order_snapshot_lines_snapshot_line").on(table.snapshotId, table.lineId),
    index("idx_order_snapshot_lines_order").on(table.orderId),
    index("idx_order_snapshot_lines_product").on(table.productId, table.productName)
  ]
);

export const salesLedgerEntries = sqliteTable(
  "sales_ledger_entries",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    entryType: text("entry_type").notNull(),
    orderId: text("order_id").notNull(),
    orderNumber: text("order_number").notNull(),
    paymentId: text("payment_id"),
    originalEntryId: text("original_entry_id"),
    lineId: text("line_id"),
    productId: text("product_id"),
    productName: text("product_name"),
    productCategory: text("product_category"),
    taxCodeId: text("tax_code_id"),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    quantity: integer("quantity").notNull(),
    grossAmount: integer("gross_amount").notNull(),
    taxAmount: integer("tax_amount").notNull(),
    complimentaryValue: integer("complimentary_value").notNull().default(0),
    actorUserId: text("actor_user_id"),
    actorDisplayName: text("actor_display_name"),
    actorRole: text("actor_role"),
    actorDeviceId: text("actor_device_id"),
    paymentMethod: text("payment_method"),
    terminalId: text("terminal_id"),
    provider: text("provider"),
    providerTransactionId: text("provider_transaction_id"),
    providerRefundId: text("provider_refund_id"),
    providerStatus: text("provider_status"),
    reason: text("reason"),
    businessDate: text("business_date").notNull(),
    occurredAt: integer("occurred_at").notNull()
  },
  (table) => [
    index("idx_sales_ledger_business_date").on(table.businessDate, table.occurredAt),
    index("idx_sales_ledger_order").on(table.orderId, table.entryType),
    index("idx_sales_ledger_payment").on(table.paymentId),
    index("idx_sales_ledger_method").on(table.paymentMethod, table.businessDate),
    index("idx_sales_ledger_terminal").on(table.terminalId, table.businessDate)
  ]
);

export const localOutbox = sqliteTable(
  "local_outbox",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
    syncedAt: integer("synced_at"),
    syncAttemptCount: integer("sync_attempt_count").notNull().default(0),
    lastSyncError: text("last_sync_error")
  },
  (table) => [
    index("idx_local_outbox_pending").on(table.syncedAt, table.createdAt),
    index("idx_local_outbox_aggregate").on(table.aggregateId, table.createdAt)
  ]
);

export const commandInbox = sqliteTable(
  "command_inbox",
  {
    id: text("id").primaryKey(),
    commandType: text("command_type").notNull(),
    requestId: text("request_id").notNull(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    status: text("status").notNull(),
    resultJson: text("result_json"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at")
  },
  (table) => [
    uniqueIndex("idx_command_inbox_command_request").on(table.commandType, table.requestId),
    index("idx_command_inbox_status").on(table.status, table.updatedAt)
  ]
);

export const localWalleeConfig = sqliteTable(
  "local_wallee_config",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    locationId: text("location_id").notNull(),
    localMasterInstanceId: text("local_master_instance_id").notNull(),
    relayProfileId: text("relay_profile_id").notNull(),
    configVersion: integer("config_version").notNull(),
    spaceId: text("space_id").notNull(),
    applicationUserId: text("application_user_id").notNull(),
    authenticationKeyEncrypted: text("authentication_key_encrypted").notNull(),
    confirmationPolicy: text("confirmation_policy").notNull().default("EXPLICIT"),
    receiptPolicy: text("receipt_policy").notNull().default("FETCH_AND_QUEUE_UNPRINTED"),
    status: text("status").notNull(),
    checksum: text("checksum").notNull(),
    validationError: text("validation_error"),
    activatedAt: integer("activated_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("idx_local_wallee_config_version").on(table.tenantId, table.locationId, table.configVersion),
    index("idx_local_wallee_config_active").on(table.status, table.updatedAt)
  ]
);

export const localWalleeTerminals = sqliteTable(
  "local_wallee_terminals",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().references(() => localWalleeConfig.id, { onDelete: "cascade" }),
    relayTerminalId: text("relay_terminal_id").notNull(),
    displayName: text("display_name").notNull(),
    terminalId: text("terminal_id"),
    terminalIdentifier: text("terminal_identifier"),
    isDefault: integer("is_default").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("idx_local_wallee_terminal_config_relay").on(table.configId, table.relayTerminalId),
    index("idx_local_wallee_terminal_active").on(table.configId, table.isActive, table.isDefault)
  ]
);

export const localWalleeConfigAudit = sqliteTable(
  "local_wallee_config_audit",
  {
    id: text("id").primaryKey(),
    configVersion: integer("config_version").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    checksum: text("checksum").notNull(),
    error: text("error"),
    createdAt: integer("created_at").notNull()
  },
  (table) => [index("idx_local_wallee_config_audit_version").on(table.configVersion, table.createdAt)]
);

export const paymentAttempts = sqliteTable(
  "payment_attempts",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    orderId: text("order_id"),
    paymentId: text("payment_id"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    method: text("method").notNull(),
    walleeTerminalConfigId: text("wallee_terminal_config_id"),
    merchantReference: text("merchant_reference").notNull(),
    providerTransactionId: text("provider_transaction_id"),
    providerState: text("provider_state"),
    lifecycleState: text("lifecycle_state").notNull(),
    reconciliationRequired: integer("reconciliation_required").notNull().default(0),
    failureReason: text("failure_reason"),
    requestJson: text("request_json").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at")
  },
  (table) => [
    uniqueIndex("idx_payment_attempt_request").on(table.requestId),
    uniqueIndex("idx_payment_attempt_merchant_reference").on(table.merchantReference),
    index("idx_payment_attempt_provider_transaction").on(table.providerTransactionId),
    index("idx_payment_attempt_recovery").on(table.reconciliationRequired, table.lifecycleState, table.updatedAt)
  ]
);

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    paymentAttemptId: text("payment_attempt_id").notNull().references(() => paymentAttempts.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    providerState: text("provider_state"),
    payloadJson: text("payload_json"),
    createdAt: integer("created_at").notNull()
  },
  (table) => [index("idx_payment_events_attempt").on(table.paymentAttemptId, table.createdAt)]
);

export const paymentReceipts = sqliteTable(
  "payment_receipts",
  {
    id: text("id").primaryKey(),
    paymentAttemptId: text("payment_attempt_id").notNull().references(() => paymentAttempts.id, { onDelete: "cascade" }),
    providerTransactionId: text("provider_transaction_id").notNull(),
    receiptType: text("receipt_type").notNull(),
    mimeType: text("mime_type").notNull(),
    dataBase64: text("data_base64").notNull(),
    printedByProvider: integer("printed_by_provider").notNull().default(0),
    printJobId: text("print_job_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("idx_payment_receipt_attempt_type").on(table.paymentAttemptId, table.receiptType),
    index("idx_payment_receipt_transaction").on(table.providerTransactionId)
  ]
);

export const paymentRecoveryJobs = sqliteTable(
  "payment_recovery_jobs",
  {
    id: text("id").primaryKey(),
    paymentAttemptId: text("payment_attempt_id").notNull().references(() => paymentAttempts.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("idx_payment_recovery_attempt_operation").on(table.paymentAttemptId, table.operation),
    index("idx_payment_recovery_pending").on(table.status, table.nextAttemptAt)
  ]
);
