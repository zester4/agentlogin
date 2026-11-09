import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectedAccounts,
  createDatabase,
  PostgresConnectedAccountRepository,
  tenants,
  users,
  type Database,
} from "@agentlogin/database";
import { sql } from "drizzle-orm";
import { connectedAccountRoutes } from "./connected-accounts.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!connectionString);

integration("connected-account API tenant isolation", () => {
  let handle: ReturnType<typeof createDatabase> | undefined;

  beforeAll(() => {
    if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
    handle = createDatabase(connectionString);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it("lists only the authenticated tenant's accounts and cannot revoke another tenant's account", async () => {
    if (!handle) throw new Error("Database integration handle was not initialized");

    const suffix = crypto.randomUUID();
    const tenantA = `api-rls-a-${suffix}`;
    const tenantB = `api-rls-b-${suffix}`;
    const userA = `api-rls-user-a-${suffix}`;
    const userB = `api-rls-user-b-${suffix}`;
    const accountA = `api-rls-account-a-${suffix}`;
    const accountB = `api-rls-account-b-${suffix}`;
    const rollbackSignal = new Error("rollback API integration fixtures");
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
        await tx.insert(tenants).values({ id: tenantA, name: "Synthetic API tenant A" });
        await tx.insert(users).values({
          id: userA, tenantId: tenantA, authSubject: `api-subject-a-${suffix}`, status: "active",
        });
        await tx.insert(connectedAccounts).values({
          id: accountA, tenantId: tenantA, userId: userA,
          provider: "synthetic", origin: "https://example.test",
          displayLabel: "Tenant A API fixture", status: "active",
        });

        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantB}, true)`);
        await tx.insert(tenants).values({ id: tenantB, name: "Synthetic API tenant B" });
        await tx.insert(users).values({
          id: userB, tenantId: tenantB, authSubject: `api-subject-b-${suffix}`, status: "active",
        });
        await tx.insert(connectedAccounts).values({
          id: accountB, tenantId: tenantB, userId: userB,
          provider: "synthetic", origin: "https://example.test",
          displayLabel: "Tenant B API fixture", status: "active",
        });

        // The test pre-handler stands in for a successfully verified OIDC
        // principal. Tenant identity is server-side; request input is ignored.
        const app = Fastify({ logger: false });
        app.decorate("authenticateUser", async (request) => {
          request.userPrincipal = { tenantId: tenantA, userId: userA } as never;
        });
        await connectedAccountRoutes(app, { database: tx as unknown as Database });

        const listResponse = await app.inject({
          method: "GET",
          url: "/v1/connected-accounts?tenant_id=" + encodeURIComponent(tenantB),
        });
        expect(listResponse.statusCode).toBe(200);
        expect(listResponse.json().accounts.map((account: { account_id: string }) => account.account_id))
          .toEqual([accountA]);

        const revokeResponse = await app.inject({
          method: "POST",
          url: `/v1/connected-accounts/${accountB}/revoke`,
        });
        expect(revokeResponse.statusCode).toBe(404);
        expect(revokeResponse.json().error.code).toBe("connected_account_not_found");

        await app.close();

        const repositoryB = new PostgresConnectedAccountRepository(
          tx as unknown as Database,
          tenantB,
        );
        const accountsB = await repositoryB.listForUser(userB);
        expect(accountsB).toHaveLength(1);
        expect(accountsB[0]).toMatchObject({ accountId: accountB, status: "active" });

        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) throw error;
      rolledBack = true;
    }

    expect(rolledBack).toBe(true);
  });
});
