import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!connectionString);

integration("PostgreSQL row-level security integration", () => {
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

  it("enforces tenant visibility and write isolation for the non-bypass runtime role", async () => {
    await client.query("BEGIN");
    try {
      const role = await client.query<{
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>(
        "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user",
      );
      expect(role.rows[0]?.rolsuper).toBe(false);
      expect(role.rows[0]?.rolbypassrls).toBe(false);

      await client.query(
        "CREATE TEMP TABLE agentlogin_rls_probe (tenant_id text NOT NULL, value text NOT NULL) ON COMMIT DROP",
      );
      await client.query(
        "ALTER TABLE pg_temp.agentlogin_rls_probe ENABLE ROW LEVEL SECURITY",
      );
      await client.query(
        "ALTER TABLE pg_temp.agentlogin_rls_probe FORCE ROW LEVEL SECURITY",
      );
      await client.query(
        `CREATE POLICY agentlogin_rls_probe_tenant
         ON pg_temp.agentlogin_rls_probe
         USING (tenant_id = current_setting('app.tenant_id', true))
         WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,
      );

      await client.query("SELECT set_config('app.tenant_id', 'tenant-a', true)");
      await client.query(
        "INSERT INTO pg_temp.agentlogin_rls_probe VALUES ('tenant-a', 'A')",
      );
      await client.query("SELECT set_config('app.tenant_id', 'tenant-b', true)");
      await client.query(
        "INSERT INTO pg_temp.agentlogin_rls_probe VALUES ('tenant-b', 'B')",
      );

      await client.query("SELECT set_config('app.tenant_id', 'tenant-a', true)");
      const tenantA = await client.query(
        "SELECT value FROM pg_temp.agentlogin_rls_probe",
      );
      expect(tenantA.rows).toEqual([{ value: "A" }]);

      await client.query("SELECT set_config('app.tenant_id', 'tenant-b', true)");
      const tenantB = await client.query(
        "SELECT value FROM pg_temp.agentlogin_rls_probe",
      );
      expect(tenantB.rows).toEqual([{ value: "B" }]);

      await client.query("SELECT set_config('app.tenant_id', '', true)");
      const noTenant = await client.query(
        "SELECT value FROM pg_temp.agentlogin_rls_probe",
      );
      expect(noTenant.rows).toEqual([]);

      await client.query("SELECT set_config('app.tenant_id', 'tenant-a', true)");
      await expect(
        client.query(
          "INSERT INTO pg_temp.agentlogin_rls_probe VALUES ('tenant-b', 'blocked')",
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
