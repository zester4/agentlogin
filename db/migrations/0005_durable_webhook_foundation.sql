CREATE TABLE "webhook_endpoints" ("id" text PRIMARY KEY NOT NULL,"tenant_id" text NOT NULL REFERENCES "tenants"("id"),"developer_id" text NOT NULL,"url" text NOT NULL,"event_types" text[] NOT NULL,"status" text DEFAULT 'active' NOT NULL,"secret_ciphertext" bytea NOT NULL,"secret_iv" bytea NOT NULL,"secret_auth_tag" bytea NOT NULL,"wrapped_dek" bytea NOT NULL,"key_version" text NOT NULL,"secret_version" integer DEFAULT 1 NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL,"disabled_at" timestamp with time zone,CONSTRAINT "webhook_endpoints_tenant_id_unique" UNIQUE("tenant_id","id"),CONSTRAINT "webhook_endpoints_url_length" CHECK (char_length(url) BETWEEN 8 AND 2048),CONSTRAINT "webhook_endpoints_event_types_nonempty" CHECK (cardinality(event_types) > 0),CONSTRAINT "webhook_endpoints_status" CHECK (status IN ('active','disabled')),CONSTRAINT "webhook_endpoints_secret_version_positive" CHECK (secret_version > 0),CONSTRAINT "webhook_endpoints_secret_iv_length" CHECK (octet_length(secret_iv) = 12),CONSTRAINT "webhook_endpoints_secret_auth_tag_length" CHECK (octet_length(secret_auth_tag) = 16),CONSTRAINT "webhook_endpoints_tenant_developer_fk" FOREIGN KEY ("tenant_id","developer_id") REFERENCES "developers"("tenant_id","id"));
--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant_status" ON "webhook_endpoints" ("tenant_id","status");
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_endpoints" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE TABLE "webhook_events" ("id" text PRIMARY KEY NOT NULL,"tenant_id" text NOT NULL REFERENCES "tenants"("id"),"event_type" text NOT NULL,"resource_type" text NOT NULL,"resource_id" text NOT NULL,"payload" jsonb NOT NULL,"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,CONSTRAINT "webhook_events_tenant_id_unique" UNIQUE("tenant_id","id"),CONSTRAINT "webhook_events_payload_object" CHECK (jsonb_typeof(payload) = 'object'));
--> statement-breakpoint
CREATE INDEX "webhook_events_tenant_created" ON "webhook_events" ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX "webhook_events_tenant_resource" ON "webhook_events" ("tenant_id","resource_type","resource_id");
--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_events" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" ("id" text PRIMARY KEY NOT NULL,"tenant_id" text NOT NULL REFERENCES "tenants"("id"),"endpoint_id" text NOT NULL,"event_id" text NOT NULL,"status" text DEFAULT 'pending' NOT NULL,"attempt_count" integer DEFAULT 0 NOT NULL,"max_attempts" integer DEFAULT 8 NOT NULL,"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,"lease_token" text,"lease_expires_at" timestamp with time zone,"delivered_at" timestamp with time zone,"dead_lettered_at" timestamp with time zone,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL,CONSTRAINT "webhook_deliveries_tenant_id_unique" UNIQUE("tenant_id","id"),CONSTRAINT "webhook_deliveries_tenant_endpoint_event_unique" UNIQUE("tenant_id","endpoint_id","event_id"),CONSTRAINT "webhook_deliveries_status" CHECK (status IN ('pending','leased','delivered','dead_lettered','cancelled')),CONSTRAINT "webhook_deliveries_attempt_count" CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),CONSTRAINT "webhook_deliveries_tenant_endpoint_fk" FOREIGN KEY ("tenant_id","endpoint_id") REFERENCES "webhook_endpoints"("tenant_id","id"),CONSTRAINT "webhook_deliveries_tenant_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "webhook_events"("tenant_id","id"));
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due" ON "webhook_deliveries" ("status","next_attempt_at","created_at");
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_tenant_endpoint_created" ON "webhook_deliveries" ("tenant_id","endpoint_id","created_at");
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_deliveries" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE TABLE "webhook_delivery_attempts" ("id" text PRIMARY KEY NOT NULL,"tenant_id" text NOT NULL REFERENCES "tenants"("id"),"delivery_id" text NOT NULL,"attempt_number" integer NOT NULL,"outcome" text NOT NULL,"http_status" integer,"latency_ms" integer,"response_summary" text,"error_code" text,"started_at" timestamp with time zone DEFAULT now() NOT NULL,"completed_at" timestamp with time zone,CONSTRAINT "webhook_delivery_attempts_tenant_id_unique" UNIQUE("tenant_id","id"),CONSTRAINT "webhook_delivery_attempts_tenant_delivery_number_unique" UNIQUE("tenant_id","delivery_id","attempt_number"),CONSTRAINT "webhook_delivery_attempts_number_positive" CHECK (attempt_number > 0),CONSTRAINT "webhook_delivery_attempts_outcome" CHECK (outcome IN ('succeeded','retryable_failure','permanent_failure','timeout')),CONSTRAINT "webhook_delivery_attempts_http_status" CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),CONSTRAINT "webhook_delivery_attempts_latency" CHECK (latency_ms IS NULL OR latency_ms >= 0),CONSTRAINT "webhook_delivery_attempts_tenant_delivery_fk" FOREIGN KEY ("tenant_id","delivery_id") REFERENCES "webhook_deliveries"("tenant_id","id"));
--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_tenant_delivery" ON "webhook_delivery_attempts" ("tenant_id","delivery_id","attempt_number");
--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_delivery_attempts" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
