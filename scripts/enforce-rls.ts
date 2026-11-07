import "dotenv/config";
import { Pool } from "pg";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error("DATABASE_URL_UNPOOLED is required to enforce FORCE ROW LEVEL SECURITY.");
  }

  const tables = [
    "tenants", "users", "developers", "developer_memberships", "agents", "connected_accounts",
    "credentials", "delegations", "grants", "approvals", "executions",
    "audit_events", "agent_credentials",
  ] as const;

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    application_name: "agentlogin-migration-rls",
  });

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const table of tables) {
        const state = await client.query<{ relrowsecurity: boolean }>(
          "SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind = 'r'",
          [table],
        );
        if (state.rowCount !== 1 || !state.rows[0]?.relrowsecurity) {
          throw new Error(`RLS is not enabled on public.${table}; refusing to continue.`);
        }
        await client.query(`ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Failed to enforce FORCE ROW LEVEL SECURITY:", error);
  process.exitCode = 1;
});
