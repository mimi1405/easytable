ALTER TABLE "catalog_categories" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "catalog_categories" ADD COLUMN "default_station_id" text;--> statement-breakpoint
ALTER TABLE "catalog_taxes" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "catalog_categories" ADD CONSTRAINT "catalog_categories_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_taxes" ADD CONSTRAINT "catalog_taxes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_catalog_categories_location" ON "catalog_categories" USING btree ("tenant_id","location_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_catalog_taxes_location" ON "catalog_taxes" USING btree ("tenant_id","location_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_catalog_products_location_category" ON "catalog_products" USING btree ("tenant_id","location_id","category_id","name");
