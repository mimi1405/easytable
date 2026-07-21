ALTER TABLE `order_snapshots` ADD `actor_json` text;--> statement-breakpoint
ALTER TABLE `order_snapshot_lines` ADD `complimentary_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_snapshot_lines` ADD `complimentary_value` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_ledger_entries` ADD `tax_code_id` text;--> statement-breakpoint
ALTER TABLE `sales_ledger_entries` ADD `tax_rate_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_ledger_entries` ADD `complimentary_value` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales_ledger_entries` ADD `actor_user_id` text;--> statement-breakpoint
ALTER TABLE `sales_ledger_entries` ADD `actor_display_name` text;--> statement-breakpoint
ALTER TABLE `sales_ledger_entries` ADD `actor_role` text;--> statement-breakpoint
ALTER TABLE `sales_ledger_entries` ADD `actor_device_id` text;
