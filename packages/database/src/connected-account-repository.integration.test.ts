import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectedAccounts,
  createDatabase,
  PostgresConnectedAccountRepository,
  tenants,
  users,
  type Database,
} from "./index.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!connectionString);

integration("connected-account repository tenant isolation", () => {
  let handle: ReturnType<typeof createDatabase> | undefined;

  beforeAll(() => {
    if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
    handle = createDatabase(connectionString);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it("scopes list and disconnect operations to the authenticated tenant", async () => {
    if (!handle) throw new Error("Database integration handle was not initialized");
    const suffix = crypto.randomUUID();
    const tenantA = `repo-rls-a-${suffix}`;
    const tenantB = `repo-rls-b-${suffix}`;
    const userA = `repo-rls-user-a-${suffix}`;
    const userB = `repo-rls-user-b-${suffix}`;
    const accountA = `repo-rls-account-a-${suffix}`;
    const accountB = `repo-rls-account-b-${suffix}`;
    const rollbackSignal = new Error("rollback integration fixtures");
    let rolledBack = false;

    try {
      await handle.db.transaction(async (tx) => {
        const role = await tx.execute<{
          current_user: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>(sql`SELECT current_user, r.rolsuper, r.rolbypassrls
          FROM pg_roles r WHERE r.rolname = current_user`);
        expect(role.rows[0]).toEqual({
          current_user: "agentlogin_runtime",
          rolsuper: false,
          rolbypassrls: false,
        });

        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantA}, true)`);
        await tx.insert(tenants).values({ id: tenantA, name: "Synthetic repository tenant A" });
        await tx.insert(users).values({
          id: userA, tenantId: tenantA, authSubject: `subject-a-${suffix}`, status: "active",
        });
        await tx.insert(connectedAccounts).values({
          id: accountA, tenantId: tenantA, userId: userA,
          provider: "synthetic", origin: "https://example.test",
          displayLabel: "Tenant A synthetic account", status: "active",
        });

        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantB}, true)`);
        await tx.insert(tenants).values({ id: tenantB, name: "Synthetic repository tenant B" });
        await tx.insert(users).values({
          id: userB, tenantId: tenantB, authSubject: `subject-b-${suffix}`, status: "active",
        });
        await tx.insert(connectedAccounts).values({
          id: accountB, tenantId: tenantB, userId: userB,
          provider: "synthetic", origin: "https://example.test",
          displayLabel: "Tenant B synthetic account", status: "active",
        });

        const repositoryA = new PostgresConnectedAccountRepository(
          tx as unknown as Database,
          tenantA,
        );
        const accountsA = await repositoryA.listForUser(userA);
        expect(accountsA.map((account) => account.accountId)).toEqual([accountA]);

        // Even when given Tenant B's identifiers, a Tenant A repository cannot
        // revoke Tenant B's account.
        await expect(repositoryA.disconnect(accountB, userB)).resolves.toBe(false);

        const repositoryB = new PostgresConnectedAccountRepository(
          tx as unknown as Database,
          tenantB,
        );
        const accountsB = await repositoryB.listForUser(userB);
        expect(accountsB).toHaveLength(1);
        expect(accountsB[0]).toMatchObject({
          accountId: accountB,
          status: "active",
        });

        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) throw error;
      rolledBack = true;
    }

    expect(rolledBack).toBe(true);
  });
});
