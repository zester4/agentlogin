CREATE TABLE "developer_applications" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id"),
  "developer_id" text NOT NULL,
  "name" text NOT NULL,
  "client_id" text NOT NULL,
  "client_secret_hash" bytea NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at" timestamp with time zone,
  CONSTRAINT "developer_applications_tenant_id_unique" UNIQUE("tenant_id","id"),
  CONSTRAINT "developer_applications_client_id_unique" UNIQUE("client_id"),
  CONSTRAINT "developer_applications_secret_hash_length" CHECK (octet_length("client_secret_hash") = 32),
  CONSTRAINT "developer_applications_status" CHECK ("status" IN ('active','suspended','revoked')),
  CONSTRAINT "developer_applications_tenant_developer_fk" FOREIGN KEY ("tenant_id","developer_id") REFERENCES "developers"("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "developer_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "developer_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "developer_applications" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE INDEX "developer_applications_tenant_developer" ON "developer_applications" ("tenant_id","developer_id");
--> statement-breakpoint
CREATE TABLE "application_access_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "application_id" text NOT NULL,
  "token_hash" bytea NOT NULL,
  "scopes" text[] NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  CONSTRAINT "application_access_tokens_tenant_id_unique" UNIQUE("tenant_id","id"),
  CONSTRAINT "application_access_tokens_token_hash_unique" UNIQUE("token_hash"),
  CONSTRAINT "application_access_tokens_hash_length" CHECK (octet_length("token_hash") = 32),
  CONSTRAINT "application_access_tokens_expiry_after_issue" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "application_access_tokens_tenant_application_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "developer_applications"("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "application_access_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "application_access_tokens" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "application_access_tokens" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE INDEX "application_access_tokens_active_lookup" ON "application_access_tokens" ("tenant_id","id","expires_at") WHERE "revoked_at" IS NULL;
