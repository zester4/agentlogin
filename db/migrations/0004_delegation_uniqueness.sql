ALTER TABLE "delegations" ADD CONSTRAINT "delegations_tenant_user_agent_account_unique" UNIQUE("tenant_id","user_id","agent_id","account_id");
