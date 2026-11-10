import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const adminUrl = process.env.DATABASE_URL;
const workerUrl = process.env.WORKER_TEST_DATABASE_URL;
const integration = describe.skipIf(!adminUrl || !workerUrl);

integration("isolated login worker database boundary", () => {
  const suffix = randomUUID();
  const tenantA = `worker-rls-a-${suffix}`;
  const tenantB = `worker-rls-b-${suffix}`;
  const userA = `worker-rls-user-a-${suffix}`;
  const userB = `worker-rls-user-b-${suffix}`;
  const accountA = `worker-rls-account-a-${suffix}`;
  const accountB = `worker-rls-account-b-${suffix}`;
  const credentialA = `worker-rls-credential-a-${suffix}`;
  const credentialB = `worker-rls-credential-b-${suffix}`;
  const admin = new Client({ connectionString: adminUrl, application_name: "agentlogin-worker-boundary-fixture" });
  const worker = new Client({ connectionString: workerUrl, application_name: "agentlogin-login-worker-test" });

  beforeAll(async () => {
    await admin.connect();
    await worker.connect();
    await admin.query("BEGIN");
    try {
      await admin.query(
        "INSERT INTO public.tenants (id, name, status) VALUES ($1, 'Synthetic worker RLS A', 'active'), ($2, 'Synthetic worker RLS B', 'active')",
        [tenantA, tenantB],
      );
      await admin.query(
        "INSERT INTO public.users (id, tenant_id, auth_subject, status) VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')",
        [userA, tenantA, `subject-a-${suffix}`, userB, tenantB, `subject-b-${suffix}`],
      );
      await admin.query(
        "INSERT INTO public.connected_accounts (id, tenant_id, user_id, provider, origin, display_label, status) VALUES ($1, $2, $3, 'synthetic', 'https://worker-a.invalid', 'Synthetic A', 'active'), ($4, $5, $6, 'synthetic', 'https://worker-b.invalid', 'Synthetic B', 'active')",
        [accountA, tenantA, userA, accountB, tenantB, userB],
      );
      await admin.query(
        "INSERT INTO public.credentials (id, tenant_id, account_id, credential_id, credential_type, ciphertext, iv, auth_tag, wrapped_dek, key_version, record_version, status) VALUES ($1, $2, $3, $4, 'website_login', decode('01', 'hex'), decode(repeat('01', 12), 'hex'), decode(repeat('02', 16), 'hex'), decode('03', 'hex'), 'ci-synthetic-key', 1, 'active'), ($5, $6, $7, $8, 'website_login', decode('04', 'hex'), decode(repeat('04', 12), 'hex'), decode(repeat('05', 16), 'hex'), decode('06', 'hex'), 'ci-synthetic-key', 1, 'active')",
        [credentialA, tenantA, accountA, `credential-a-${suffix}`, credentialB, tenantB, accountB, `credential-b-${suffix}`],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }, 30_000);

  afterAll(async () => {
    if (admin.readyForQuery) {
      await admin.query("BEGIN");
      try {
        await admin.query("DELETE FROM public.credentials WHERE tenant_id = ANY($1::text[])", [[tenantA, tenantB]]);
        await admin.query("DELETE FROM public.connected_accounts WHERE tenant_id = ANY($1::text[])", [[tenantA, tenantB]]);
        await admin.query("DELETE FROM public.users WHERE tenant_id = ANY($1::text[])", [[tenantA, tenantB]]);
        await admin.query("DELETE FROM public.tenants WHERE id = ANY($1::text[])", [[tenantA, tenantB]]);
        await admin.query("COMMIT");
      } catch {
        await admin.query("ROLLBACK").catch(() => undefined);
      }
    }
    await worker.end().catch(() => undefined);
    await admin.end().catch(() => undefined);
  }, 30_000);

  it("has only the required read columns and no write or grant/lease access", async () => {
    const result = await worker.query<{
      current_user: string;
      rolbypassrls: boolean;
      rolsuper: boolean;
      credential_table_select: boolean;
      credential_created_at: boolean;
      credential_id_select: boolean;
      credential_ciphertext_select: boolean;
      account_table_select: boolean;
      account_status_select: boolean;
      credential_insert: boolean;
      credential_update: boolean;
      account_update: boolean;
      grants_select: boolean;
      leases_select: boolean;
    }>(`SELECT
      current_user,
      r.rolbypassrls,
      r.rolsuper,
      has_table_privilege(current_user, 'public.credentials', 'SELECT') AS credential_table_select,
      has_column_privilege(current_user, 'public.credentials', 'created_at', 'SELECT') AS credential_created_at,
      has_column_privilege(current_user, 'public.credentials', 'id', 'SELECT') AS credential_id_select,
      has_column_privilege(current_user, 'public.credentials', 'ciphertext', 'SELECT') AS credential_ciphertext_select,
      has_table_privilege(current_user, 'public.connected_accounts', 'SELECT') AS account_table_select,
      has_column_privilege(current_user, 'public.connected_accounts', 'status', 'SELECT') AS account_status_select,
      has_table_privilege(current_user, 'public.credentials', 'INSERT') AS credential_insert,
      has_table_privilege(current_user, 'public.credentials', 'UPDATE') AS credential_update,
      has_table_privilege(current_user, 'public.connected_accounts', 'UPDATE') AS account_update,
      has_table_privilege(current_user, 'public.grants', 'SELECT') AS grants_select,
      has_table_privilege(current_user, 'public.credential_leases', 'SELECT') AS leases_select
      FROM pg_roles r WHERE r.rolname = current_user`);
    expect(result.rows[0]).toEqual({
      current_user: "agentlogin_worker",
      rolbypassrls: false,
      rolsuper: false,
      credential_table_select: false,
      credential_created_at: false,
      credential_id_select: true,
      credential_ciphertext_select: true,
      account_table_select: false,
      account_status_select: true,
      credential_insert: false,
      credential_update: false,
      account_update: false,
      grants_select: false,
      leases_select: false,
    });
  });

  it("fails closed without tenant context and isolates the two synthetic tenants", async () => {
    const withoutContext = await worker.query(
      "SELECT c.id FROM public.credentials c JOIN public.connected_accounts a ON a.tenant_id = c.tenant_id AND a.id = c.account_id",
    );
    expect(withoutContext.rows).toEqual([]);

    await worker.query("BEGIN");
    try {
      await worker.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const visibleA = await worker.query<{ id: string }>(
        "SELECT c.id FROM public.credentials c JOIN public.connected_accounts a ON a.tenant_id = c.tenant_id AND a.id = c.account_id WHERE c.tenant_id = ANY($1::text[]) ORDER BY c.id",
        [[tenantA, tenantB]],
      );
      expect(visibleA.rows.map((row) => row.id)).toEqual([credentialA]);

      await worker.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      const visibleB = await worker.query<{ id: string }>(
        "SELECT c.id FROM public.credentials c JOIN public.connected_accounts a ON a.tenant_id = c.tenant_id AND a.id = c.account_id WHERE c.tenant_id = ANY($1::text[]) ORDER BY c.id",
        [[tenantA, tenantB]],
      );
      expect(visibleB.rows.map((row) => row.id)).toEqual([credentialB]);

      await worker.query("SELECT set_config('app.tenant_id', '', true)");
      const afterClear = await worker.query(
        "SELECT c.id FROM public.credentials c JOIN public.connected_accounts a ON a.tenant_id = c.tenant_id AND a.id = c.account_id",
      );
      expect(afterClear.rows).toEqual([]);
      await worker.query("COMMIT");
    } catch (error) {
      await worker.query("ROLLBACK");
      throw error;
    }
  });
});
