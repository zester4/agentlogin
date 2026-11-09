CREATE TABLE "credential_leases" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id"),
  "token_hash" bytea NOT NULL,
  "user_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "grant_id" text NOT NULL,
  "account_id" text NOT NULL,
  "credential_ref" text NOT NULL,
  "credential_id" text NOT NULL,
  "record_version" integer NOT NULL,
  "origin" text NOT NULL,
  "execution_id" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "credential_leases_tenant_id_unique" UNIQUE("tenant_id","id"),
  CONSTRAINT "credential_leases_token_hash_unique" UNIQUE("token_hash"),
  CONSTRAINT "credential_leases_token_hash_length" CHECK (octet_length("token_hash") = 32),
  CONSTRAINT "credential_leases_record_version_positive" CHECK ("record_version" > 0),
  CONSTRAINT "credential_leases_expiry_after_issue" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "credential_leases_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "users"("tenant_id","id"),
  CONSTRAINT "credential_leases_tenant_agent_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "agents"("tenant_id","id"),
  CONSTRAINT "credential_leases_tenant_grant_fk" FOREIGN KEY ("tenant_id","grant_id") REFERENCES "grants"("tenant_id","id"),
  CONSTRAINT "credential_leases_tenant_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "connected_accounts"("tenant_id","id"),
  CONSTRAINT "credential_leases_tenant_credential_fk" FOREIGN KEY ("tenant_id","credential_ref") REFERENCES "credentials"("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "credential_leases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credential_leases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "credential_leases" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE INDEX "credential_leases_active_lookup" ON "credential_leases" ("tenant_id","id","expires_at") WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "credential_leases_execution_lookup" ON "credential_leases" ("tenant_id","execution_id");
