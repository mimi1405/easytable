CREATE TABLE "station_pickups" (
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
	"ready_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "station_pickups" ADD CONSTRAINT "station_pickups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_station_pickups_location_status" ON "station_pickups" USING btree ("tenant_id","location_id","status","ready_at");
