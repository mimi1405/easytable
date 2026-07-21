export type TenantStatus = "ACTIVE" | "SUSPENDED";
export type UserStatus = "ACTIVE" | "INVITED" | "DISABLED";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
};

export type TenantCreateRequest = {
  name: string;
  slug: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  status?: TenantStatus;
};

export type TenantUpdateRequest = Partial<TenantCreateRequest>;

export type TenantUserRole = "OWNER" | "MANAGER" | "STAFF" | "KDS" | "POS_OPERATOR";

export type TenantLocationUser = {
  user_id: string;
  tenant_id: string;
  location_id: string;
  email: string;
  display_name: string;
  role: TenantUserRole;
  status: UserStatus;
  has_password: boolean;
  has_pin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TenantLocationUserCreateRequest = {
  email: string;
  display_name: string;
  role: TenantUserRole;
  password?: string | null;
  pin?: string | null;
  status?: UserStatus;
  is_active?: boolean;
};

export type TenantLocationUserUpdateRequest = Partial<TenantLocationUserCreateRequest>;

export type PlatformAdministrator = {
  user_id: string;
  email: string;
  display_name: string;
  role: "platform_admin";
  status: UserStatus;
  created_at: string;
  updated_at: string;
};

export type PlatformAdministratorCreateRequest = {
  email: string;
  display_name: string;
  status?: UserStatus;
};

export type PlatformAdministratorUpdateRequest = {
  display_name?: string;
  status?: UserStatus;
};

export type PlatformAdministratorCreateResponse = {
  user: PlatformAdministrator;
  email_sent: boolean;
};

export type PlatformAdministratorResetPasswordResponse = {
  user: PlatformAdministrator;
  email_sent: boolean;
};

export type AccountSetupContext = {
  email: string;
  display_name: string;
  kind: "platform_admin" | "location_user";
  requires_pin: boolean;
  tenant_id: string | null;
  location_id: string | null;
};

export type AccountSetupCompleteRequest = {
  password?: string | null;
  pin?: string | null;
};

export type AccountSetupCompleteResponse = {
  ok: true;
  kind: AccountSetupContext["kind"];
};

export type TenantLocationUserResetPasswordRequest = {
  password?: string | null;
  send_email?: boolean;
};

export type TenantLocationUserResetPasswordResponse = {
  user: TenantLocationUser;
  email_sent: boolean;
};

export type TenantLocationUserResetPinRequest = {
  pin?: string | null;
};

export type TenantLocationUserResetPinResponse = {
  user: TenantLocationUser;
  generated_pin?: string;
};

export type LocationStatus = "ACTIVE" | "SUSPENDED";
export type LocationServiceMode = "TABLE_SERVICE" | "COUNTER_SERVICE";

export type Location = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  address: string | null;
  local_master_instance_id: string | null;
  service_mode: LocationServiceMode;
  status: LocationStatus;
  created_at: string;
  updated_at: string;
};

export type LocationCreateRequest = {
  name: string;
  slug: string;
  address?: string | null;
  local_master_instance_id?: string | null;
  service_mode?: LocationServiceMode;
  status?: LocationStatus;
};

export type LocationUpdateRequest = Partial<LocationCreateRequest>;

export type CatalogOutputStation = {
  id: string;
  tenant_id: string;
  location_id: string | null;
  name: string;
  kind: string;
  has_kds: boolean;
  has_printer: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CatalogOutputStationCreateRequest = {
  name: string;
  has_kds: boolean;
  has_printer: boolean;
  is_active?: boolean;
  sort_order?: number;
};

export type CatalogOutputStationUpdateRequest = Partial<CatalogOutputStationCreateRequest>;

export type LocalMasterPairingSessionStatus = "ACTIVE" | "USED" | "EXPIRED" | "NONE";

export type LocalMasterPairingSession = {
  id: string;
  tenant_id: string;
  location_id: string;
  setup_code: string | null;
  status: LocalMasterPairingSessionStatus;
  expires_at: string | null;
  used_at: string | null;
  local_master_instance_id: string | null;
  local_master_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type LocalMasterPairRequest = {
  setup_code: string;
  instance_id: string;
  location_id?: string | null;
  local_master_url?: string | null;
  version?: string | null;
};

export type LocalMasterPairResponse = {
  tenant_id: string;
  location_id: string;
  local_master_instance_id: string;
  relay_token: string;
  relay_base_url: string;
  paired_at: string;
};

export type RelayCommand = {
  command_id: string;
  tenant_id: string;
  location_id: string;
  local_master_instance_id: string;
  type: string;
  status: "pending" | "delivered" | "accepted" | "failed";
  payload: unknown;
  result: unknown | null;
  created_at: string;
  updated_at: string;
};

export type RelayCommandAckRequest = {
  status: "accepted" | "failed";
  result?: unknown;
  error?: string | null;
};

export type LocalMasterFinancialEvent = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: unknown;
  created_at: number;
};

export type LocalMasterFinancialEventsRequest = {
  tenant_id?: string;
  location_id?: string;
  local_master_instance_id?: string;
  events: LocalMasterFinancialEvent[];
};

export type LocalMasterFinancialEventsResponse = {
  accepted_event_ids: string[];
  failed_events: Array<{ id: string; error: string }>;
};

export type WalleePaymentMode = "CLOUD_TILL_LONG_POLLING";

export type WalleePaymentProfile = {
  id: string;
  tenant_id: string;
  location_id: string | null;
  space_id: string;
  application_user_id: string;
  has_application_user_secret: boolean;
  has_webhook_signature_key: boolean;
  mode: WalleePaymentMode;
  enabled: boolean;
  config_version: number;
  config_delivery: {
    status: "pending" | "delivered" | "accepted" | "failed" | "unpublished";
    active_local_master_version: number | null;
    error: string | null;
    updated_at: string | null;
  };
  created_at: string;
  updated_at: string;
};

export type WalleePaymentProfileUpsertRequest = {
  space_id: string;
  application_user_id: string;
  application_user_secret?: string | null;
  webhook_signature_key?: string | null;
  enabled?: boolean;
};

export type WalleePaymentTerminal = {
  id: string;
  profile_id: string;
  tenant_id: string;
  location_id: string | null;
  display_name: string;
  terminal_id: string | null;
  terminal_identifier: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type WalleePaymentTerminalCreateRequest = {
  display_name: string;
  terminal_id?: string | null;
  terminal_identifier?: string | null;
  is_default?: boolean;
  is_active?: boolean;
};

export type WalleePaymentTerminalUpdateRequest = Partial<WalleePaymentTerminalCreateRequest>;

export type LocalMasterPaymentConfig = {
  config_version: number;
  checksum: string;
  tenant_id: string;
  location_id: string;
  local_master_instance_id: string;
  wallee: {
    enabled: boolean;
    mode: WalleePaymentMode;
    profile_id: string;
    space_id: string;
    application_user_id: string;
    authentication_key: string;
    confirmation_policy: "EXPLICIT";
    receipt_policy: "FETCH_AND_QUEUE_UNPRINTED";
    terminals: WalleePaymentTerminal[];
  } | null;
};

export type StaffOrderSnapshotRelayRequest = {
  request_id: string;
  lines: unknown[];
  table_context: unknown;
};

export type StaffComplimentaryAdjustRelayRequest = {
  request_id: string;
  line_id: string;
  complimentary_quantity: number;
};

export type StaffRelayCommandResponse = RelayCommand & {
  poll_url: string;
};

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
  product_type: CatalogProductType;
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

export type OpenTableOrderBasket = {
  order_id: string;
  order_number: string;
  lines: BasketLine[];
};

export type StationPickupStatus = "READY" | "ACKNOWLEDGED";

export type StationPickup = {
  id: string;
  order_id: string;
  order_number: string;
  table_id: string;
  table_name: string;
  station: string;
  status: StationPickupStatus;
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    variants: BasketLineVariant[];
  }>;
  ready_at: number;
  acknowledged_at: number | null;
};

export type KdsTicketStatus = "OPEN" | "IN_PROGRESS" | "DONE";

export type KdsTicket = {
  id: string;
  order_id: string;
  order_number: string;
  table_id: string;
  table_name: string;
  station: string;
  status: KdsTicketStatus;
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    variants: BasketLineVariant[];
  }>;
  created_at: number;
  updated_at: number;
  done_at: number | null;
};

export type LocalMasterOperationsSnapshot = {
  open_table_baskets: Array<{
    table_id: string;
    table_name: string;
    table_context: unknown;
    basket: OpenTableOrderBasket;
    subtotal: number;
    tax_total: number;
    total: number;
    opened_at: number;
    updated_at: number;
  }>;
  kds_tickets: KdsTicket[];
  station_pickups: StationPickup[];
  synced_at: string;
};

export type CatalogProductType = "BASIC" | "SERVICE";

export type CatalogProduct = {
  id: string;
  category_id: string;
  tax_id: string;
  product_type: CatalogProductType;
  name: string;
  category: string;
  price: number;
  tax_code_id: string;
  tax_code_name: string;
  tax_rate_bps: number;
  is_available: boolean;
  isAvailable?: boolean;
  station_id: string | null;
  station_name: string | null;
  station: string;
  created_at?: number;
  updated_at?: number;
};

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

export type OwnerCatalogSnapshot = {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  taxes: CatalogTax[];
  output_stations: CatalogOutputStation[];
};

export type OwnerCatalogCommandRequest = {
  request_id: string;
  action: string;
  payload?: unknown;
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

export type LocalMasterBootstrap = {
  tenant: Tenant;
  location: Location;
  service_mode: LocationServiceMode;
  output_stations: CatalogOutputStation[];
  users: Array<{
    user_id: string;
    email: string;
    display_name: string;
    role: TenantUserRole;
    status: "ACTIVE" | "INVITED" | "DISABLED";
    pin_hash: string | null;
    is_active: boolean;
  }>;
  bootstrapped_at: string;
};

export type OnboardingStatus = {
  tenant_id: string;
  location_id: string;
  tenant_ready: boolean;
  location_ready: boolean;
  output_station_count: number;
  user_count: number;
  pairing_status: LocalMasterPairingSessionStatus | "PAIRED";
  local_master_instance_id: string | null;
};
