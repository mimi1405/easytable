ALTER TABLE "catalog_output_stations" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "catalog_output_stations" ADD CONSTRAINT "catalog_output_stations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_catalog_output_stations_location" ON "catalog_output_stations" USING btree ("tenant_id","location_id","is_active","sort_order");
--> statement-breakpoint
INSERT INTO "tenants" ("id", "name", "slug", "email", "phone", "website", "status")
VALUES ('tenant_basilica', 'Basilica', 'basilica', NULL, NULL, NULL, 'ACTIVE')
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "slug" = EXCLUDED."slug",
  "status" = EXCLUDED."status",
  "updated_at" = now();
--> statement-breakpoint
INSERT INTO "locations" ("id", "tenant_id", "name", "slug", "address", "local_master_instance_id", "status")
VALUES ('loc_basilica_main', 'tenant_basilica', 'Hauptstandort', 'hauptstandort', NULL, NULL, 'ACTIVE')
ON CONFLICT ("id") DO UPDATE SET
  "tenant_id" = EXCLUDED."tenant_id",
  "name" = EXCLUDED."name",
  "slug" = EXCLUDED."slug",
  "status" = EXCLUDED."status",
  "updated_at" = now();
--> statement-breakpoint
INSERT INTO "catalog_output_stations" ("id", "tenant_id", "location_id", "name", "kind", "is_active", "sort_order")
VALUES
  ('station_shisha', 'tenant_basilica', 'loc_basilica_main', 'Shisha', 'KDS_AND_PRINTER', 1, 10),
  ('station_bar', 'tenant_basilica', 'loc_basilica_main', 'Bar', 'KDS_AND_PRINTER', 1, 20),
  ('station_snack', 'tenant_basilica', 'loc_basilica_main', 'Snack', 'KDS_AND_PRINTER', 1, 30)
ON CONFLICT ("id") DO UPDATE SET
  "tenant_id" = EXCLUDED."tenant_id",
  "location_id" = EXCLUDED."location_id",
  "name" = EXCLUDED."name",
  "kind" = EXCLUDED."kind",
  "is_active" = EXCLUDED."is_active",
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = now();
