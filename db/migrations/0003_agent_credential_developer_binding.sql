ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_developer_id_unique" UNIQUE("tenant_id","developer_id","id");
--> statement-breakpoint
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_tenant_developer_agent_fk" FOREIGN KEY ("tenant_id","developer_id","agent_id") REFERENCES "public"."agents"("tenant_id","developer_id","id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;
