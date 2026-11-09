import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  auditEvents,
  createDatabase,
  developers,
  PostgresAgentCredentialRepository,
  tenants,
  type Database,
} from "./index.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!connectionString);

integration("agent credential repository PostgreSQL concurrency", () => {
  let setupHandle: ReturnType<typeof createDatabase> | undefined;
  let rotationHandleA: ReturnType<typeof createDatabase> | undefined;
  let rotationHandleB: ReturnType<typeof createDatabase> | undefined;

  beforeAll(() => {
    if (!connectionString) throw new Error("TEST_DATABASE_URL is required");
    // Separate pools guarantee the concurrent rotations use independent
    // PostgreSQL sessions rather than a single transaction/connection.
    setupHandle = createDatabase(connectionString);
    rotationHandleA = createDatabase(connectionString);
    rotationHandleB = createDatabase(connectionString);
  });

  afterAll(async () => {
    await Promise.all([
      setupHandle?.close(),
      rotationHandleA?.close(),
      rotationHandleB?.close(),
    ]);
  });

  it("leaves exactly one active credential after simultaneous rotations", async () => {
    if (!setupHandle || !rotationHandleA || !rotationHandleB) {
      throw new Error("Database integration handles were not initialized");
    }

    const suffix = randomUUID();
    const tenantId = `agent-rotation-test-${suffix}`;
    const developerId = `agent-rotation-developer-${suffix}`;
    const agentId = `agent-rotation-agent-${suffix}`;
    const credentialIds = [
      `agent-rotation-credential-a-${suffix}`,
      `agent-rotation-credential-b-${suffix}`,
    ];
    let fixturesCreated = false;

    try {
      // Commit only uniquely named synthetic fixtures so the two repository
      // transactions can see them. The finally block removes every fixture.
      await setupHandle.db.transaction(async (tx) => {
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

        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
        await tx.insert(tenants).values({
          id: tenantId,
          name: "Synthetic concurrent rotation test tenant",
        });
        await tx.insert(developers).values({
          id: developerId,
          tenantId,
          name: "Synthetic concurrent rotation test developer",
          status: "active",
        });
        await tx.insert(agents).values({
          id: agentId,
          tenantId,
          developerId,
          name: "Synthetic concurrent rotation test agent",
          identityType: "service",
          status: "active",
        });
      });
      fixturesCreated = true;

      const repositoryA = new PostgresAgentCredentialRepository(
        rotationHandleA.db as Database,
        tenantId,
      );
      const repositoryB = new PostgresAgentCredentialRepository(
        rotationHandleB.db as Database,
        tenantId,
      );
      const now = Date.now();
      const makeRecord = (credentialId: string, offset: number) => ({
        credentialId,
        tenantId,
        developerId,
        agentId,
        tokenHash: randomBytes(32),
        createdAt: new Date(now + offset),
        expiresAt: new Date(now + offset + 60 * 60 * 1000),
      });

      await Promise.all([
        repositoryA.rotate(makeRecord(credentialIds[0]!, 0)),
        repositoryB.rotate(makeRecord(credentialIds[1]!, 1)),
      ]);

      const persisted = await setupHandle.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
        const credentials = await tx.execute<{
          id: string;
          revoked_at: Date | null;
        }>(sql`SELECT id, revoked_at FROM agent_credentials
          WHERE tenant_id = ${tenantId} AND agent_id = ${agentId}`);
        const events = await tx.execute<{ count: string }>(sql`SELECT count(*)::text AS count
          FROM audit_events
          WHERE tenant_id = ${tenantId}
            AND event_type = 'agent_credential.rotated'`);
        return { credentials: credentials.rows, auditCount: Number(events.rows[0]?.count ?? 0) };
      });

      expect(persisted.credentials).toHaveLength(2);
      expect(persisted.credentials.filter((row) => row.revoked_at === null)).toHaveLength(1);
      expect(persisted.credentials.filter((row) => row.revoked_at !== null)).toHaveLength(1);
      expect(persisted.credentials.map((row) => row.id).sort()).toEqual([...credentialIds].sort());
      expect(persisted.auditCount).toBe(2);
    } finally {
      if (fixturesCreated && setupHandle) {
        await setupHandle.db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
          await tx.execute(sql`DELETE FROM agent_credentials
            WHERE tenant_id = ${tenantId} AND agent_id = ${agentId}`);
          await tx.delete(auditEvents).where(sql`tenant_id = ${tenantId}`);
          await tx.delete(agents).where(sql`tenant_id = ${tenantId} AND id = ${agentId}`);
          await tx.delete(developers).where(sql`tenant_id = ${tenantId} AND id = ${developerId}`);
          await tx.delete(tenants).where(sql`id = ${tenantId}`);
        });
      }
    }
  });
});
