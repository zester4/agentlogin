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

      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await client.query(
        "INSERT INTO public.users (id, tenant_id, auth_subject, status) VALUES ($1, $2, $3, 'active')",
        [userA, tenantA, `subject-a-${suffix}`],
      );
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      await client.query(
        "INSERT INTO public.users (id, tenant_id, auth_subject, status) VALUES ($1, $2, $3, 'active')",
        [userB, tenantB, `subject-b-${suffix}`],
      );

      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const visibleToA = await client.query(
        "SELECT id FROM public.users WHERE id = ANY($1::text[]) ORDER BY id",
        [[userA, userB]],
      );
      expect(visibleToA.rows.map((row) => row.id)).toEqual([userA]);

      const crossTenantUpdate = await client.query(
        "UPDATE public.users SET status = 'disabled' WHERE id = $1 RETURNING id",
        [userB],
      );
      expect(crossTenantUpdate.rowCount).toBe(0);

      const crossTenantDelete = await client.query(
        "DELETE FROM public.users WHERE id = $1 RETURNING id",
        [userB],
      );
      expect(crossTenantDelete.rowCount).toBe(0);

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
