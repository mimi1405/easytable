export type PosProduct = {
  id: string;
  product_type: "BASIC" | "SERVICE";
  name: string;
  category: string;
  price: number;
  tax_code_id: string;
  tax_code_name: string;
  tax_rate_bps: number;
  is_available: boolean;
  isAvailable: boolean;
  station_id: string | null;
  station_name: string | null;
  station: string;
};

export type CatalogProduct = PosProduct & {
  category_id: string;
  tax_id: string;
  created_at: number;
  updated_at: number;
};

export type CatalogOutputStationKind = "KDS" | "PRINTER" | "KDS_AND_PRINTER" | "NONE";

export type CatalogOutputStation = {
  id: string;
  tenant_id: string;
  name: string;
  kind: CatalogOutputStationKind;
  has_kds: boolean;
  has_printer: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export type StationDeviceBinding = {
  station_id: string;
  kds_device_id: string | null;
  printer_device_id: string | null;
  updated_at: number;
};

export type StationDeviceBindingUpdateRequest = {
  kds_device_id?: string | null;
  printer_device_id?: string | null;
};

export type PosDeviceBinding = {
  terminal_id: string;
  receipt_printer_device_id: string | null;
  z_report_printer_device_id: string | null;
  updated_at: number;
};

export type PosDeviceBindingUpdateRequest = {
  receipt_printer_device_id?: string | null;
  z_report_printer_device_id?: string | null;
};

export type LocalDeviceType = "PRINTER" | "KDS_DISPLAY";

export type LocalDeviceProvider = "manual" | "windows" | "escpos" | "browser";

export type LocalDevice = {
  id: string;
  name: string;
  type: LocalDeviceType;
  provider: LocalDeviceProvider;
  address_or_device_id: string | null;
  created_at: number;
  updated_at: number;
};

export type LocalDeviceCreateRequest = {
  name: string;
  type: LocalDeviceType;
  provider: LocalDeviceProvider;
  address_or_device_id?: string | null;
};

export type LocalDeviceUpdateRequest = Partial<LocalDeviceCreateRequest>;

export type PrintLogSource = "TEST" | "STATION" | "RECEIPT" | "Z_REPORT";

export type PrintLog = {
  id: string;
  device_id: string;
  device_name: string;
  source: PrintLogSource;
  title: string;
  body: string;
  created_at: number;
};

export type PrintJobSource = "STATION" | "RECEIPT" | "Z_REPORT";

export type PrintJobStatus = "PENDING" | "PRINTING" | "PRINTED" | "FAILED";

export type PrintJob = {
  id: string;
  source: PrintJobSource;
  device_id: string;
  device_name: string;
  status: PrintJobStatus;
  title: string;
  body: string;
  error: string | null;
  order_id: string | null;
  order_number: string | null;
  station_id: string | null;
  station_name: string | null;
  terminal_id: string | null;
  attempt_count: number;
  last_attempt_at: number | null;
  created_at: number;
  updated_at: number;
};

export type StationPrintJob = PrintJob;

export type CatalogCategory = {
  id: string;
  name: string;
  sort_order: number;
  default_station_id: string | null;
  default_station_name: string | null;
  product_count: number;
  created_at: number;
  updated_at: number;
};

export type CatalogTax = {
  id: string;
  name: string;
  rate_bps: number;
  sort_order: number;
  product_count: number;
  created_at: number;
  updated_at: number;
};

export type CatalogProductCreateRequest = {
  category_id: string;
  tax_id: string;
  product_type: PosProduct["product_type"];
  name: string;
  price: number;
  is_available: boolean;
  station_id?: string | null;
};

export type CatalogProductUpdateRequest = Partial<CatalogProductCreateRequest>;

export type CatalogCategoryCreateRequest = {
  name: string;
  sort_order?: number;
  default_station_id?: string | null;
};

export type CatalogCategoryUpdateRequest = Partial<CatalogCategoryCreateRequest>;

export type CatalogTaxCreateRequest = {
  id?: string;
  name: string;
  rate_bps: number;
  sort_order?: number;
};

export type CatalogTaxUpdateRequest = Partial<CatalogTaxCreateRequest>;

export type Product = PosProduct;

export type ProductVariantGroupItem = {
  id: string;
  variant_group_id: string;
  name: string;
  price_delta: number;
  is_default: boolean;
  sort_order: number;
};

export type ProductVariantGroup = {
  id: string;
  applies_to: "PRODUCT" | "CATEGORY";
  product_id: string | null;
  category: string | null;
  name: string;
  selection_type: "SINGLE" | "MULTIPLE";
  min_select: number;
  max_select: number;
  sort_order: number;
  is_required: boolean;
  items: ProductVariantGroupItem[];
};

export type TableStatus = "FREE" | "OPEN";

export type Table = {
  id: string;
  name: string;
  status: TableStatus;
  areaName: string;
};

export type TableLayout = {
  tenant: {
    id: string;
    name: string;
  };
  location: {
    id: string;
    tenant_id: string;
    name: string;
  };
  floors: TableLayoutFloor[];
};

export type TableLayoutFloor = {
  id: string;
  location_id: string;
  name: string;
  sort_order: number;
  areas: TableLayoutArea[];
};

export type TableLayoutArea = {
  id: string;
  floor_id: string;
  name: string;
  sort_order: number;
  tables: TableLayoutTable[];
};

export type TableLayoutTable = {
  id: string;
  area_id: string;
  name: string;
  seats: number;
  sort_order: number;
  open_order_id: string | null;
  open_order_number: string | null;
  open_total: number;
  open_order_count: number;
};

export type OwnerLocation = {
  id: string;
  tenant_id: string;
  name: string;
};

export type LayoutFloorCreateRequest = {
  name: string;
  sort_order?: number;
};

export type LayoutFloorUpdateRequest = Partial<LayoutFloorCreateRequest>;

export type LayoutAreaCreateRequest = {
  floor_id: string;
  name: string;
  sort_order?: number;
};

export type LayoutAreaUpdateRequest = Partial<LayoutAreaCreateRequest>;

export type LayoutTableCreateRequest = {
  area_id: string;
  name: string;
  seats: number;
  sort_order?: number;
};

export type LayoutTableUpdateRequest = Partial<LayoutTableCreateRequest>;

export type BasketLineVariant = {
  variant_group_id: string;
  variant_group_name: string;
  variant_item_id: string;
  variant_item_name: string;
  price_delta: number;
};

export type BasketLine = {
  id: string;
  product_id: string;
  product_type: PosProduct["product_type"];
  product_name: string;
  product_category: string;
  base_price: number;
  tax_code_id: string;
  tax_code_name: string;
  tax_rate_bps: number;
  station: string;
  variants: BasketLineVariant[];
  unit_total: number;
  quantity: number;
  complimentary_quantity: number;
  complimentary_value: number;
  line_total: number;
};

export type OrderActor = {
  user_id: string;
  display_name: string;
  role: string;
  device_id: string;
  terminal_id: string | null;
};

export type TableContext = {
  tenant_id: string;
  location_id: string;
  floor_id: string;
  area_id: string;
  table_id: string;
  table_name: string;
  area_name?: string;
  floor_name?: string;
  seats?: number;
};

export type OpenTableOrderBasket = {
  order_id: string;
  order_number: string;
  lines: BasketLine[];
};

export type StationPickupStatus = "READY" | "ACKNOWLEDGED";

export type StationPickupItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  variants: BasketLineVariant[];
};

export type StationPickup = {
  id: string;
  order_id: string;
  order_number: string;
  table_id: string;
  table_name: string;
  station: string;
  status: StationPickupStatus;
  items: StationPickupItem[];
  ready_at: number;
  acknowledged_at: number | null;
};

export type CreateStationPickupRequest = {
  order_id?: string;
  order_number?: string;
  table_id: string;
  table_name: string;
  station: string;
  items: StationPickupItem[];
};

export type KdsTicketStatus = "OPEN" | "IN_PROGRESS" | "DONE";

export type KdsTicketItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  variants: BasketLineVariant[];
};

export type KdsTicket = {
  id: string;
  order_id: string;
  order_number: string;
  table_id: string;
  table_name: string;
  station: string;
  status: KdsTicketStatus;
  items: KdsTicketItem[];
  created_at: number;
  updated_at: number;
  done_at: number | null;
};

export type UpdateKdsTicketStatusRequest = {
  status: KdsTicketStatus;
};

export type CreateOrderSnapshotRequest = {
  request_id?: string;
  lines: BasketLine[];
  table_context: TableContext | null;
  actor?: OrderActor;
};

export type CompleteComplimentaryOrderRequest = CreateOrderSnapshotRequest & {
  request_id: string;
  terminal_id?: string;
};

export type AdjustComplimentaryQuantityRequest = {
  request_id: string;
  order_id: string;
  line_id: string;
  complimentary_quantity: number;
  actor: OrderActor;
};

export type ComplimentaryOrderResult = {
  order_id: string;
  order_number: string;
  status: "COMPLETED";
  total: 0;
  complimentary_value: number;
  terminal_id: string | null;
  completed_at: number;
};

export type CreatedOrderSnapshot = {
  id: string;
  order_number: string;
  status: "OPEN" | string;
  payment_status: "UNPAID" | string;
  subtotal: number;
  tax_total: number;
  total: number;
  created_at: number;
  table_id: string | null;
  table_name: string | null;
  continued_existing_order: boolean;
};

export type PaymentMethod = "CASH" | "WALLEE_TERMINAL";

export type PaymentLifecycleState =
  | "payment_started"
  | "provider_pending"
  | "provider_authorized"
  | "provider_completed"
  | "local_recorded"
  | "receipt_pending"
  | "receipt_queued"
  | "completed"
  | "declined"
  | "cancelled"
  | "failed"
  | "reversal_required"
  | "reconciliation_required";

export type CompleteCashPaymentRequest = CreateOrderSnapshotRequest & {
  request_id: string;
  payment_method: "CASH";
  received_cash?: number;
  change_given?: number;
  terminal_id?: string;
};

export type StartWalleeTerminalPaymentRequest = CreateOrderSnapshotRequest & {
  request_id: string;
  wallee_terminal_config_id?: string;
  pos_terminal_id?: string;
};

export type PaymentResult = {
  order_id: string;
  order_number: string;
  payment_id: string;
  payment_attempt_id: string | null;
  request_id: string;
  payment_method: PaymentMethod | string;
  amount: number;
  received_cash: number | null;
  change_given: number | null;
  status: "COMPLETED" | string;
  paid_at: number;
  terminal_id: string | null;
  provider: string;
  provider_transaction_id: string | null;
  provider_status: string;
  lifecycle_state: PaymentLifecycleState;
  reconciliation_required: boolean;
  receipt_print_job_id: string | null;
  failure_reason: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

export type OrderSnapshotResponse = {
  id: string;
  order_id: string;
  order_number: string;
  snapshot_type: "PAID" | "COMPLIMENTARY";
  table_context: TableContext | null;
  lines: BasketLine[];
  actor: OrderActor | null;
  subtotal: number;
  tax_total: number;
  total: number;
  payment: {
    payment_id: string;
    request_id: string;
    method: string;
    amount: number;
    terminal_id: string | null;
    provider: string;
    provider_transaction_id: string | null;
    provider_status: string;
    lifecycle_state: string;
    paid_at: number;
  };
  terminal_id: string | null;
  business_date: string;
  created_at: number;
  refunded_total: number;
  remaining_total: number;
};

export type OrderSnapshotListItem = OrderSnapshotResponse & {
  storno_state: "NONE" | "PARTIAL" | "FULL";
};

export type CreateOrderStornoRequest = {
  request_id: string;
  kind: "FULL" | "PARTIAL";
  reason: string;
  terminal_id?: string;
  business_date?: string;
  lines?: Array<{
    line_id: string;
    quantity: number;
  }>;
  provider?: string;
  provider_refund_id?: string;
  provider_status?: string;
};

export type SalesLedgerEntry = {
  id: string;
  request_id: string;
  entry_type: "SALE_COMPLETED" | "COMPLIMENTARY_RECORDED" | "PAYMENT_RECORDED" | "ORDER_VOIDED" | "ORDER_PARTIALLY_VOIDED" | "REFUND_RECORDED";
  order_id: string;
  order_number: string;
  payment_id: string | null;
  original_entry_id: string | null;
  line_id: string | null;
  product_id: string | null;
  product_name: string | null;
  product_category: string | null;
  tax_code_id: string | null;
  tax_rate_bps: number;
  quantity: number;
  gross_amount: number;
  tax_amount: number;
  complimentary_value: number;
  actor_user_id: string | null;
  actor_display_name: string | null;
  actor_role: string | null;
  actor_device_id: string | null;
  payment_method: string | null;
  terminal_id: string | null;
  provider: string | null;
  provider_transaction_id: string | null;
  provider_refund_id: string | null;
  provider_status: string | null;
  reason: string | null;
  business_date: string;
  occurred_at: number;
};

export type StornoResult = {
  order_id: string;
  order_number: string;
  kind: "FULL" | "PARTIAL";
  reason: string;
  refunded_amount: number;
  remaining_amount: number;
  provider: string;
  provider_transaction_id: string | null;
  provider_refund_id: string | null;
  provider_status: string;
  ledger_entries: SalesLedgerEntry[];
};

export type SalesReport = {
  business_date: string;
  window_start_ms: number;
  window_end_ms: number;
  gross_total: number;
  tax_total: number;
  order_count: number;
  item_count: number;
  complimentary_quantity: number;
  complimentary_value: number;
  payment_totals: {
    cash: number;
    wallee_terminal: number;
  };
  product_sales: DayCloseProductSale[];
  complimentary_sales: DayCloseProductSale[];
  entries: SalesLedgerEntry[];
};


export type PosPeripheralSettings = {
  enabled: boolean;
  provider: string;
  device_id: string | null;
};

export type LocationServiceMode = "TABLE_SERVICE" | "COUNTER_SERVICE";

export type PosSettings = {
  schema_version: number;
  tenant_id: string;
  location_id: string;
  service_mode: LocationServiceMode;
  language: string;
  business_day_cutover_time: string;
  receipt_printer: PosPeripheralSettings;
  payment_terminal: PosPeripheralSettings;
};

export type PosSettingsFile = {
  path: string;
  settings: PosSettings;
};

export type CurrentBusinessDateRequest = {
  business_day_cutover_time: string;
};

export type CurrentBusinessDate = {
  business_date: string;
};

export type DayClosePreviewRequest = {
  business_date: string;
  business_day_cutover_time: string;
};

export type DayClosePreview = {
  business_date: string;
  business_day_cutover_time: string;
  window_start_ms: number;
  window_end_ms: number;
  expected_cash: number;
  expected_card: number;
  expected_total: number;
  order_count: number;
  item_count: number;
  complimentary_quantity: number;
  complimentary_value: number;
  product_sales: DayCloseProductSale[];
  complimentary_sales: DayCloseProductSale[];
  existing_close: {
    counted_cash: number;
    cash_difference: number;
    created_at: number;
  } | null;
};

export type DayCloseProductSale = {
  product_id: string;
  product_name: string;
  product_category: string;
  quantity: number;
  total: number;
};

export type SaveDayCloseRequest = {
  request_id: string;
  business_date: string;
  business_day_cutover_time: string;
  counted_cash: number;
  terminal_id?: string;
};

export type RetryPrintJobRequest = {
  request_id?: string;
};

export type SavedDayClose = {
  business_date: string;
  total_cash: number;
  total_card: number;
  counted_cash: number;
  cash_difference: number;
  order_count: number;
  item_count: number;
  created_at: number;
};
export type OrderDraftItem = {
  productId: string;
  quantity: number;
  notes?: string;
};

export type OrderDraft = {
  source: "STAFF";
  deviceId: string;
  tableId: string;
  guestCount: number;
  items: OrderDraftItem[];
};

export type OrderItem = OrderDraftItem & {
  productName: string;
  unitPrice: number;
  totalPrice: number;
};

export type Order = {
  id: string;
  orderNumber: string;
  source: "STAFF";
  deviceId: string;
  locationId?: string;
  tableId: string;
  tableName: string;
  guestCount: number;
  status: "OPEN" | "CLOSED";
  total: number;
  items: OrderItem[];
  createdAt: number;
  closedAt?: number | null;
};


export type LocalMasterIdentity = {
  ok: true;
  service: "localMaster";
  instance_id: string;
  location_id: string;
  port: number;
  version: string;
  service_version: string;
  api_version: number;
  minimum_client_api_version: number;
  maximum_client_api_version: number;
};

export type PairingSessionRequest = {
  local_master_url?: string;
};

export type PairingSession = {
  code: string;
  expires_at: number;
  instance_id: string;
  local_master_url: string | null;
  location_id: string;
};

export type PairTerminalRequest = {
  code: string;
  terminal_name: string;
  local_master_url: string;
  role?: "POS_TERMINAL" | "MASTER_POS" | "STAFF_DEVICE";
  device_fingerprint?: string;
};

export type TerminalPairingConfig = {
  localMasterUrl: string;
  localMasterInstanceId: string;
  terminalId: string;
  terminalName: string;
  terminalRole: string;
  terminalSecret: string;
  pairedAt: number;
  lastSeenAt: number;
};

export type TerminalHeartbeatRequest = {
  terminal_secret: string;
};

export type TerminalRecord = {
  id: string;
  instance_id: string;
  name: string;
  role: string;
  device_fingerprint: string | null;
  paired_at: number;
  last_seen_at: number;
};

export type CloudBindingStatus = "UNPAIRED" | "PAIRED" | "PAIRED_BOOTSTRAP_FAILED" | "INVALID";

export type CloudBinding = {
  status: CloudBindingStatus;
  tenant_id: string | null;
  location_id: string | null;
  local_master_instance_id: string | null;
  relay_base_url: string | null;
  paired_at: string | null;
  last_verified_at: string | null;
  invalid_reason: string | null;
  bootstrap_completed_at: string | null;
  bootstrap_error: string | null;
};

export type CloudPairRequest = {
  relay_base_url: string;
  setup_code: string;
  local_master_url?: string | null;
};

export type CloudPairResponse = CloudBinding & {
  relay_token_present: boolean;
};

export type BootstrapUser = {
  user_id: string;
  email: string;
  display_name: string;
  role: "OWNER" | "MANAGER" | "STAFF" | "KDS" | "POS_OPERATOR";
  status: "ACTIVE" | "INVITED" | "DISABLED";
  pin_hash: string | null;
  is_active: boolean;
};

export type LocalMasterBootstrap = {
  tenant: {
    id: string;
    name: string;
    slug: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  };
  location: {
    id: string;
    tenant_id: string;
    name: string;
    slug: string;
    address: string | null;
    local_master_instance_id: string | null;
    service_mode: "TABLE_SERVICE" | "COUNTER_SERVICE";
    status: string;
    created_at: string;
    updated_at: string;
  };
  service_mode: "TABLE_SERVICE" | "COUNTER_SERVICE";
  output_stations: CatalogOutputStation[];
  users: BootstrapUser[];
  bootstrapped_at: string;
};
export type RealtimeEventType =
  | "CONNECTED"
  | "DEVICE_CONNECTED"
  | "DEVICE_CONFIG_UPDATED"
  | "DEVICE_DISCONNECTED"
  | "INVALID_MESSAGE"
  | "BOOTSTRAP_REFRESHED"
  | "CATALOG_UPDATED"
  | "ORDER_CREATED"
  | "ORDER_UPDATED"
  | "ORDER_COMPLIMENTARY_COMPLETED"
  | "ORDER_STORNO_RECORDED"
  | "KDS_TICKET_CREATED"
  | "KDS_TICKET_UPDATED"
  | "KDS_TICKETS_REBUILT"
  | "PAYMENT_COMPLETED"
  | "PAYMENT_UPDATED"
  | "PAYMENT_CONFIG_UPDATED"
  | "PRINT_JOB_CREATED"
  | "PRINT_JOB_UPDATED"
  | "PRINT_LOG_CREATED"
  | "STATION_PICKUP_READY"
  | "STATION_PICKUP_ACKNOWLEDGED"
  | "TABLE_UPDATED"
  | "TABLE_LAYOUT_UPDATED";

export type RealtimeEvent = {
  id: string;
  type: RealtimeEventType;
  createdAt: number;
  payload: unknown;
};






