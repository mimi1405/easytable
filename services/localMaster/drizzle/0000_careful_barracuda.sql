CREATE TABLE IF NOT EXISTS `catalog_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `catalog_categories_name_unique` ON `catalog_categories` (`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `catalog_products` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`tax_id` text,
	`product_type` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`tax_code_id` text NOT NULL,
	`tax_code_name` text NOT NULL,
	`tax_rate_bps` integer NOT NULL,
	`is_available` integer NOT NULL,
	`station` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `catalog_categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_catalog_products_category` ON `catalog_products` (`category_id`,`name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_catalog_products_station` ON `catalog_products` (`station`,`product_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_catalog_products_tax` ON `catalog_products` (`tax_id`,`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `catalog_taxes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_catalog_taxes_rate` ON `catalog_taxes` (`rate_bps`,`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `day_closes` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`total_cash` integer NOT NULL,
	`total_card` integer NOT NULL,
	`order_count` integer NOT NULL,
	`item_count` integer NOT NULL,
	`report_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `day_closes_date_unique` ON `day_closes` (`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `local_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `order_item_variant_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`order_item_id` text NOT NULL,
	`variant_group_id` text,
	`variant_group_name` text NOT NULL,
	`variant_item_id` text,
	`variant_item_name` text NOT NULL,
	`price_delta` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_item_variants_item` ON `order_item_variant_snapshots` (`order_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`product_type` text NOT NULL,
	`product_name` text NOT NULL,
	`product_category` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`tax_code_id` text,
	`tax_code_name` text NOT NULL,
	`tax_rate_bps` integer NOT NULL,
	`tax_amount` integer NOT NULL,
	`total_price` integer NOT NULL,
	`station` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_order_items_order` ON `order_items` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`floor_id` text NOT NULL,
	`area_id` text NOT NULL,
	`table_id` text,
	`table_name` text,
	`service_mode` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`subtotal` integer NOT NULL,
	`tax_total` integer NOT NULL,
	`total` integer NOT NULL,
	`payment_status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`closed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `orders_order_number_unique` ON `orders` (`order_number`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_orders_open_table` ON `orders` (`table_id`,`service_mode`,`status`,`payment_status`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `paired_terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`secret` text NOT NULL,
	`device_fingerprint` text,
	`paired_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_paired_terminals_seen` ON `paired_terminals` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pairing_sessions` (
	`code` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`display_url` text,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pairing_sessions_expires` ON `pairing_sessions` (`expires_at`,`used_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`amount` integer NOT NULL,
	`received_cash` integer,
	`change_given` integer,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`provider_transaction_id` text,
	`provider_status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payments_day_close` ON `payments` (`status`,`method`,`created_at`);
