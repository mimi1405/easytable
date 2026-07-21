ALTER TABLE "order_snapshots" ADD COLUMN IF NOT EXISTS "actor_json" jsonb;--> statement-breakpoint
ALTER TABLE "order_snapshot_lines" ADD COLUMN IF NOT EXISTS "complimentary_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_snapshot_lines" ADD COLUMN IF NOT EXISTS "complimentary_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ledger_entries" ADD COLUMN IF NOT EXISTS "tax_code_id" text;--> statement-breakpoint
ALTER TABLE "sales_ledger_entries" ADD COLUMN IF NOT EXISTS "tax_rate_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ledger_entries" ADD COLUMN IF NOT EXISTS "complimentary_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ledger_entries" ADD COLUMN IF NOT EXISTS "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "sales_ledger_entries" ADD COLUMN IF NOT EXISTS "actor_display_name" text;--> statement-breakpoint
ALTER TABLE "sales_ledger_entries" ADD COLUMN IF NOT EXISTS "actor_role" text;--> statement-breakpoint
ALTER TABLE "sales_ledger_entries" ADD COLUMN IF NOT EXISTS "actor_device_id" text;
