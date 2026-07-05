CREATE TABLE "layout_floors" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layout_floors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "layout_floors_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "idx_layout_floors_location" ON "layout_floors" USING btree ("tenant_id","location_id","sort_order","name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_layout_floors_location_name" ON "layout_floors" USING btree ("tenant_id","location_id","name");--> statement-breakpoint
CREATE TABLE "layout_areas" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"floor_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layout_areas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "layout_areas_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "layout_areas_floor_id_layout_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."layout_floors"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "idx_layout_areas_floor" ON "layout_areas" USING btree ("tenant_id","location_id","floor_id","sort_order","name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_layout_areas_floor_name" ON "layout_areas" USING btree ("tenant_id","location_id","floor_id","name");--> statement-breakpoint
CREATE TABLE "layout_tables" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"area_id" text NOT NULL,
	"name" text NOT NULL,
	"seats" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layout_tables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "layout_tables_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "layout_tables_area_id_layout_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."layout_areas"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "idx_layout_tables_area" ON "layout_tables" USING btree ("tenant_id","location_id","area_id","sort_order","name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_layout_tables_area_name" ON "layout_tables" USING btree ("tenant_id","location_id","area_id","name");
