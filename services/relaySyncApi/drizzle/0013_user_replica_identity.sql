ALTER TABLE "tenant_users" REPLICA IDENTITY USING INDEX "idx_tenant_users_unique";
ALTER TABLE "tenant_user_locations" REPLICA IDENTITY USING INDEX "idx_tenant_user_locations_unique";
