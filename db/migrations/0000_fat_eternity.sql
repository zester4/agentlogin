CREATE TABLE "agent_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"developer_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "agent_credentials_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "agent_credentials_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "agent_credentials_token_hash_length" CHECK (octet_length(token_hash) = 32),
	CONSTRAINT "agent_credentials_expiry_after_issue" CHECK (expires_at > created_at)
);
--> statement-breakpoint
ALTER TABLE "agent_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"developer_id" text NOT NULL,
	"name" text NOT NULL,
	"identity_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"decision" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_ref" text,
	"decision" text,
	"correlation_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"origin" text NOT NULL,
	"display_label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connected_accounts_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "connected_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"account_id" text NOT NULL,
	"credential_type" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"key_version" text NOT NULL,
	"record_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"account_id" text NOT NULL,
	"scopes" text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delegations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "developers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "developers_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "developers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "executions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL,
	"safe_result_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "executions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"account_id" text NOT NULL,
	"origin" text NOT NULL,
	"scopes" text[] NOT NULL,
	"task_id" text,
	"policy_version" integer NOT NULL,
	"approval_id" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grants_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "grants_expiry_after_issue" CHECK (expires_at > issued_at)
);
--> statement-breakpoint
ALTER TABLE "grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"auth_subject" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_tenant_auth_subject_unique" UNIQUE("tenant_id","auth_subject"),
	CONSTRAINT "users_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_tenant_developer_fk" FOREIGN KEY ("tenant_id","developer_id") REFERENCES "public"."developers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_tenant_agent_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_developer_fk" FOREIGN KEY ("tenant_id","developer_id") REFERENCES "public"."developers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_grant_fk" FOREIGN KEY ("tenant_id","grant_id") REFERENCES "public"."grants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tenant_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."connected_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_tenant_agent_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_tenant_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."connected_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developers" ADD CONSTRAINT "developers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_tenant_grant_fk" FOREIGN KEY ("tenant_id","grant_id") REFERENCES "public"."grants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_tenant_agent_fk" FOREIGN KEY ("tenant_id","agent_id") REFERENCES "public"."agents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_tenant_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."connected_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_credentials_active_lookup" ON "agent_credentials" USING btree ("id","expires_at") WHERE "agent_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_events_tenant_time" ON "audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "grants_active_lookup" ON "grants" USING btree ("tenant_id","agent_id","expires_at") WHERE "grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agent_credentials" AS PERMISSIVE FOR ALL TO public USING ("agent_credentials"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("agent_credentials"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agents" AS PERMISSIVE FOR ALL TO public USING ("agents"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("agents"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approvals" AS PERMISSIVE FOR ALL TO public USING ("approvals"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("approvals"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_events" AS PERMISSIVE FOR ALL TO public USING ("audit_events"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("audit_events"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "connected_accounts" AS PERMISSIVE FOR ALL TO public USING ("connected_accounts"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("connected_accounts"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "credentials" AS PERMISSIVE FOR ALL TO public USING ("credentials"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("credentials"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "delegations" AS PERMISSIVE FOR ALL TO public USING ("delegations"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("delegations"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "developers" AS PERMISSIVE FOR ALL TO public USING ("developers"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("developers"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "executions" AS PERMISSIVE FOR ALL TO public USING ("executions"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("executions"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "grants" AS PERMISSIVE FOR ALL TO public USING ("grants"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("grants"."tenant_id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenants" AS PERMISSIVE FOR ALL TO public USING ("tenants"."id" = current_setting('app.tenant_id', true)) WITH CHECK ("tenants"."id" = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING ("users"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("users"."tenant_id" = current_setting('app.tenant_id', true));