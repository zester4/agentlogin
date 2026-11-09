import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!connectionString);

integration("PostgreSQL tenant RLS integration", () => {
  const client = new Client({
    connectionString,
    application_name: "agentlogin-rls-integration-test",
  });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("isolates real tenant tables for the non-bypass runtime role and fails closed", async () => {
    const suffix = crypto.randomUUID();
    const tenantA = `rls-a-${suffix}`;
    const tenantB = `rls-b-${suffix}`;
    const userA = `rls-user-a-${suffix}`;
    const userB = `rls-user-b-${suffix}`;

    await client.query("BEGIN");
    try {
      const role = await client.query<{
        current_user: string;
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>(
        "SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user",
      );
      expect(role.rows[0]).toEqual({
        current_user: "agentlogin_runtime",
        rolbypassrls: false,
        rolsuper: false,
      });

      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await client.query(
        "INSERT INTO public.tenants (id, name, status) VALUES ($1, 'Synthetic RLS A', 'active')",
        [tenantA],
      );
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      await client.query(
        "INSERT INTO public.tenants (id, name, status) VALUES ($1, 'Synthetic RLS B', 'active')",
        [tenantB],
      );

      const tables = [
        "users", "developers", "developer_memberships", "agents",
        "connected_accounts", "credentials", "delegations", "grants",
        "approvals", "executions", "audit_events", "agent_credentials",
        "webhook_endpoints", "webhook_events", "webhook_deliveries",
        "webhook_delivery_attempts", "webhook_delivery_queue",
      ] as const;

      const seedTenant = async (tenantId: string, suffixLabel: "a" | "b") => {
        const userId = `rls-user-${suffixLabel}-${suffix}`;
        const developerId = `rls-developer-${suffixLabel}-${suffix}`;
        const agentId = `rls-agent-${suffixLabel}-${suffix}`;
        const accountId = `rls-account-${suffixLabel}-${suffix}`;
        const grantId = `rls-grant-${suffixLabel}-${suffix}`;
        const endpointId = `rls-endpoint-${suffixLabel}-${suffix}`;
        const eventId = `rls-event-${suffixLabel}-${suffix}`;
        const deliveryId = `rls-delivery-${suffixLabel}-${suffix}`;

        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await client.query(
          "INSERT INTO public.users (id, tenant_id, auth_subject, status) VALUES ($1, $2, $3, 'active')",
          [userId, tenantId, `subject-${suffixLabel}-${suffix}`],
        );
        await client.query(
          "INSERT INTO public.developers (id, tenant_id, name, status) VALUES ($1, $2, 'Synthetic developer', 'active')",
          [developerId, tenantId],
        );
        await client.query(
          "INSERT INTO public.developer_memberships (id, tenant_id, user_id, developer_id, role) VALUES ($1, $2, $3, $4, 'owner')",
          [`rls-membership-${suffixLabel}-${suffix}`, tenantId, userId, developerId],
        );
        await client.query(
          "INSERT INTO public.agents (id, tenant_id, developer_id, name, identity_type, status) VALUES ($1, $2, $3, 'Synthetic agent', 'service', 'active')",
          [agentId, tenantId, developerId],
        );
        await client.query(
          "INSERT INTO public.connected_accounts (id, tenant_id, user_id, provider, origin, display_label) VALUES ($1, $2, $3, 'synthetic', 'https://example.test', 'Synthetic account')",
          [accountId, tenantId, userId],
        );
        await client.query(
          "INSERT INTO public.credentials (id, tenant_id, account_id, credential_type, ciphertext, wrapped_dek, key_version) VALUES ($1, $2, $3, 'password', decode('00', 'hex'), decode('00', 'hex'), 'test')",
          [`rls-credential-${suffixLabel}-${suffix}`, tenantId, accountId],
        );
        await client.query(
          "INSERT INTO public.delegations (id, tenant_id, user_id, agent_id, account_id, scopes) VALUES ($1, $2, $3, $4, $5, ARRAY['read'])",
          [`rls-delegation-${suffixLabel}-${suffix}`, tenantId, userId, agentId, accountId],
        );
        await client.query(
          "INSERT INTO public.grants (id, tenant_id, user_id, agent_id, account_id, origin, scopes, policy_version, expires_at) VALUES ($1, $2, $3, $4, $5, 'https://example.test', ARRAY['read'], 1, now() + interval '1 hour')",
          [grantId, tenantId, userId, agentId, accountId],
        );
        await client.query(
          "INSERT INTO public.approvals (id, tenant_id, grant_id, requested_by, decision) VALUES ($1, $2, $3, $4, 'approved')",
          [`rls-approval-${suffixLabel}-${suffix}`, tenantId, grantId, userId],
        );
        await client.query(
          "INSERT INTO public.executions (id, tenant_id, grant_id, operation, status) VALUES ($1, $2, $3, 'read', 'succeeded')",
          [`rls-execution-${suffixLabel}-${suffix}`, tenantId, grantId],
        );
        await client.query(
          "INSERT INTO public.audit_events (id, tenant_id, actor_type, actor_id, event_type) VALUES ($1, $2, 'user', $3, 'rls.test')",
          [`rls-audit-${suffixLabel}-${suffix}`, tenantId, userId],
        );
        await client.query(
          "INSERT INTO public.agent_credentials (id, tenant_id, developer_id, agent_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, decode(repeat($5, 32), 'hex'), now() + interval '1 hour')",
          [`rls-agent-credential-${suffixLabel}-${suffix}`, tenantId, developerId, agentId, suffixLabel === "a" ? "aa" : "bb"],
        );
        await client.query(
          "INSERT INTO public.webhook_endpoints (id, tenant_id, developer_id, url, event_types, secret_ciphertext, secret_iv, secret_auth_tag, wrapped_dek, key_version) VALUES ($1, $2, $3, 'https://example.test/hook', ARRAY['test.event'], decode('00', 'hex'), decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), decode('00', 'hex'), 'test')",
          [endpointId, tenantId, developerId],
        );
        await client.query(
          "INSERT INTO public.webhook_events (id, tenant_id, event_type, resource_type, resource_id, payload) VALUES ($1, $2, 'test.event', 'test', $3, jsonb_build_object('synthetic', true))",
          [eventId, tenantId, eventId],
        );
        await client.query(
          "INSERT INTO public.webhook_deliveries (id, tenant_id, endpoint_id, event_id) VALUES ($1, $2, $3, $4)",
          [deliveryId, tenantId, endpointId, eventId],
        );
        await client.query(
          "INSERT INTO public.webhook_delivery_attempts (id, tenant_id, delivery_id, attempt_number, outcome) VALUES ($1, $2, $3, 1, 'succeeded')",
          [`rls-attempt-${suffixLabel}-${suffix}`, tenantId, deliveryId],
        );
        await client.query(
          "INSERT INTO public.webhook_delivery_queue (id, tenant_id, delivery_id) VALUES ($1, $2, $3)",
          [`rls-queue-${suffixLabel}-${suffix}`, tenantId, deliveryId],
        );
      };

      await seedTenant(tenantA, "a");
      await seedTenant(tenantB, "b");

      const expectedRows: Record<string, string> = {
        users: userA,
        developers: `rls-developer-a-${suffix}`,
        developer_memberships: `rls-membership-a-${suffix}`,
        agents: `rls-agent-a-${suffix}`,
        connected_accounts: `rls-account-a-${suffix}`,
        credentials: `rls-credential-a-${suffix}`,
        delegations: `rls-delegation-a-${suffix}`,
        grants: `rls-grant-a-${suffix}`,
        approvals: `rls-approval-a-${suffix}`,
        executions: `rls-execution-a-${suffix}`,
        audit_events: `rls-audit-a-${suffix}`,
        agent_credentials: `rls-agent-credential-a-${suffix}`,
        webhook_endpoints: `rls-endpoint-a-${suffix}`,
        webhook_events: `rls-event-a-${suffix}`,
        webhook_deliveries: `rls-delivery-a-${suffix}`,
        webhook_delivery_attempts: `rls-attempt-a-${suffix}`,
        webhook_delivery_queue: `rls-queue-a-${suffix}`,
      };

      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      for (const table of tables) {
        const visible = await client.query(
          `SELECT id FROM public.${table} WHERE tenant_id = ANY($1::text[]) ORDER BY id`,
          [[tenantA, tenantB]],
        );
        expect(visible.rows.map((row) => row.id), `cross-tenant visibility in ${table}`)
          .toEqual([expectedRows[table]]);
      }

      const tenantBRows: Record<string, string> = {
        users: userB,
        developers: `rls-developer-b-${suffix}`,
        developer_memberships: `rls-membership-b-${suffix}`,
        agents: `rls-agent-b-${suffix}`,
        connected_accounts: `rls-account-b-${suffix}`,
        credentials: `rls-credential-b-${suffix}`,
        delegations: `rls-delegation-b-${suffix}`,
        grants: `rls-grant-b-${suffix}`,
        approvals: `rls-approval-b-${suffix}`,
        executions: `rls-execution-b-${suffix}`,
        audit_events: `rls-audit-b-${suffix}`,
        agent_credentials: `rls-agent-credential-b-${suffix}`,
        webhook_endpoints: `rls-endpoint-b-${suffix}`,
        webhook_events: `rls-event-b-${suffix}`,
        webhook_deliveries: `rls-delivery-b-${suffix}`,
        webhook_delivery_attempts: `rls-attempt-b-${suffix}`,
        webhook_delivery_queue: `rls-queue-b-${suffix}`,
      };

      // The queue is deliberately insert/select-only for the runtime role.
      // Every other tenant table is checked for cross-tenant UPDATE and DELETE.
      for (const table of tables.filter((name) => name !== "webhook_delivery_queue")) {
        const blockedUpdate = await client.query(
          `UPDATE public.${table} SET id = id WHERE id = $1 RETURNING id`,
          [tenantBRows[table]],
        );
        expect(blockedUpdate.rowCount, `cross-tenant update in ${table}`).toBe(0);

        const blockedDelete = await client.query(
          `DELETE FROM public.${table} WHERE id = $1 RETURNING id`,
          [tenantBRows[table]],
        );
        expect(blockedDelete.rowCount, `cross-tenant delete in ${table}`).toBe(0);
      }

      const blockedTenantUpdate = await client.query(
        "UPDATE public.tenants SET name = name WHERE id = $1 RETURNING id",
        [tenantB],
      );
      expect(blockedTenantUpdate.rowCount).toBe(0);
      const blockedTenantDelete = await client.query(
        "DELETE FROM public.tenants WHERE id = $1 RETURNING id",
        [tenantB],
      );
      expect(blockedTenantDelete.rowCount).toBe(0);

      await client.query("SAVEPOINT cross_tenant_insert");
      await expect(
        client.query(
          "INSERT INTO public.users (id, tenant_id, auth_subject, status) VALUES ($1, $2, $3, 'active')",
          [`rls-cross-${suffix}`, tenantB, `cross-subject-${suffix}`],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT cross_tenant_insert");

      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      const tenantBRecord = await client.query(
        "SELECT id, status FROM public.users WHERE id = $1",
        [userB],
      );
      expect(tenantBRecord.rows).toEqual([{ id: userB, status: "active" }]);

      await client.query("SELECT set_config('app.tenant_id', '', true)");
      const visibleWithoutContext = await client.query(
        "SELECT id FROM public.users WHERE id = ANY($1::text[])",
        [[userA, userB]],
      );
      expect(visibleWithoutContext.rowCount).toBe(0);

      await client.query("SAVEPOINT missing_tenant_context");
      await expect(
        client.query(
          "INSERT INTO public.tenants (id, name, status) VALUES ($1, 'No Context', 'active')",
          [`rls-no-context-${suffix}`],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT missing_tenant_context");
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
