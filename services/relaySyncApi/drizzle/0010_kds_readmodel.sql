CREATE TABLE "kds_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"order_id" text NOT NULL,
	"order_number" text NOT NULL,
	"table_id" text NOT NULL,
	"table_name" text NOT NULL,
	"station" text NOT NULL,
	"status" text NOT NULL,
	"items_json" jsonb NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kds_tickets" ADD CONSTRAINT "kds_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_kds_tickets_location_station" ON "kds_tickets" USING btree ("tenant_id","location_id","station","status","created_at");
