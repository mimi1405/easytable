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
  station: string;
};

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

export type ProductCard = PosProduct & {
  tone: string;
  accent: string;
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
  line_total: number;
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

export type MockPaymentMethod = "CASH" | "CARD_MANUAL";

export type MockPaymentRequest = {
  payment_method: MockPaymentMethod;
  received_cash?: number;
  change_given?: number;
};

export type CompletedMockPayment = {
  order_id: string;
  order_number: string;
  payment_id: string;
  payment_method: MockPaymentMethod | string;
  amount: number;
  received_cash: number | null;
  change_given: number | null;
  status: "COMPLETED" | string;
  paid_at: number;
};

export type OpenTableOrderBasket = {
  order_id: string;
  order_number: string;
  lines: BasketLine[];
};

export type TableContext = {
  tenant_id: string;
  location_id: string;
  floor_id: string;
  area_id: string;
  table_id: string;
  table_name: string;
  area_name: string;
  floor_name: string;
  seats: number;
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

export type PosPeripheralSettings = {
  enabled: boolean;
  provider: string;
  device_id: string | null;
};

export type PosSettings = {
  schema_version: number;
  tenant_id: string;
  location_id: string;
  language: string;
  business_day_cutover_time: string;
  receipt_printer: PosPeripheralSettings;
  payment_terminal: PosPeripheralSettings;
};

export type PosSettingsFile = {
  path: string;
  settings: PosSettings;
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
  product_sales: DayCloseProductSale[];
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
