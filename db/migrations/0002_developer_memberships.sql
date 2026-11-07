CREATE TABLE "developer_memberships" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL,
  "developer_id" text NOT NULL,
  "role" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "developer_memberships_tenant_user_developer_unique" UNIQUE("tenant_id","user_id","developer_id")
);
--> statement-breakpoint
ALTER TABLE "developer_memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "developer_memberships" ADD CONSTRAINT "developer_memberships_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "developer_memberships" ADD CONSTRAINT "developer_memberships_tenant_developer_fk" FOREIGN KEY ("tenant_id","developer_id") REFERENCES "public"."developers"("tenant_id","id") ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "developer_memberships" AS PERMISSIVE FOR ALL TO public USING ("developer_memberships"."tenant_id" = current_setting('app.tenant_id', true)) WITH CHECK ("developer_memberships"."tenant_id" = current_setting('app.tenant_id', true));
