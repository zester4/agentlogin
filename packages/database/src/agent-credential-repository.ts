import { eq, and, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  agentCredentials,
  auditEvents,
  agents,
  developers,
  tenants,
} from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

/**
 * A repository instance is bound to a tenant obtained from a verified
 * server-side principal. Every operation enters a transaction with the
 * transaction-local RLS context before touching tenant-owned rows.
 *
 * This intentionally does not implement a global credential-ID lookup:
 * resolving a tenant from an untrusted token prefix would require a separate,
 * narrowly privileged authentication lookup design. Do not bypass RLS to
 * make that lookup convenient.
 */
export type PersistedAgentCredential = {
  credentialId: string;
  tenantId: string;
  developerId: string;
  agentId: string;
  tokenHash: Uint8Array;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  tenantStatus: "active" | "suspended" | "closed";
  developerStatus: "active" | "suspended" | "closed";
  agentStatus: "active" | "suspended" | "revoked";
};

export type NewPersistedAgentCredential = Pick<
  PersistedAgentCredential,
  | "credentialId"
  | "tenantId"
  | "developerId"
  | "agentId"
  | "tokenHash"
  | "createdAt"
  | "expiresAt"
>;

export class PostgresAgentCredentialRepository {
  constructor(
    private readonly database: Database,
    private readonly authenticatedTenantId: string,
  ) {
    if (
      !authenticatedTenantId ||
      authenticatedTenantId.trim() !== authenticatedTenantId ||
      authenticatedTenantId.length > 200
    ) {
      throw new TypeError("A verified tenant identity is required.");
    }
  }

  async insert(record: NewPersistedAgentCredential): Promise<void> {
    if (record.tenantId !== this.authenticatedTenantId) {
      throw new Error("Tenant context mismatch.");
    }

    await withTenantTransaction(
      this.database,
      this.authenticatedTenantId,
      async (tx) => {
        await tx.insert(agentCredentials).values({
          id: record.credentialId,
          tenantId: record.tenantId,
          developerId: record.developerId,
          agentId: record.agentId,
          tokenHash: Buffer.from(record.tokenHash),
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
        });
      },
    );
  }

  async rotate(record: NewPersistedAgentCredential): Promise<void> {
    if (record.tenantId !== this.authenticatedTenantId) throw new Error("Tenant context mismatch.");
    await withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      // Serialize rotations for this agent. Without a stable parent-row lock,
      // two concurrent transactions can each revoke the previous token set
      // and then both insert a new active credential.
      const [lockedAgent] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(and(
          eq(agents.tenantId, this.authenticatedTenantId),
          eq(agents.developerId, record.developerId),
          eq(agents.id, record.agentId),
        ))
        .for("update");
      if (!lockedAgent) throw new Error("Agent not found for credential rotation.");

      const previous = await tx.update(agentCredentials).set({ revokedAt: record.createdAt }).where(and(
        eq(agentCredentials.tenantId, this.authenticatedTenantId),
        eq(agentCredentials.agentId, record.agentId),
        isNull(agentCredentials.revokedAt)
      )).returning({ id: agentCredentials.id });
      await tx.insert(agentCredentials).values({
        id: record.credentialId, tenantId: record.tenantId,
        developerId: record.developerId, agentId: record.agentId,
        tokenHash: Buffer.from(record.tokenHash), createdAt: record.createdAt,
        expiresAt: record.expiresAt
      });
      await tx.insert(auditEvents).values({
        id: record.credentialId + "_rotated", tenantId: this.authenticatedTenantId,
        actorType: "system", actorId: "agent_credential_service",
        eventType: "agent_credential.rotated", resourceRef: record.credentialId,
        decision: "rotated", metadata: { agent_ref: record.agentId, revoked_count: previous.length }
      });
    });
  }

  async findById(
    credentialId: string,
  ): Promise<PersistedAgentCredential | null> {
    if (!credentialId) return null;

    return withTenantTransaction(
      this.database,
      this.authenticatedTenantId,
      async (tx) => {
        const [row] = await tx
          .select({
            credentialId: agentCredentials.id,
            tenantId: agentCredentials.tenantId,
            developerId: agentCredentials.developerId,
            agentId: agentCredentials.agentId,
            tokenHash: agentCredentials.tokenHash,
            createdAt: agentCredentials.createdAt,
            expiresAt: agentCredentials.expiresAt,
            revokedAt: agentCredentials.revokedAt,
            tenantStatus: tenants.status,
            developerStatus: developers.status,
            agentStatus: agents.status,
          })
          .from(agentCredentials)
          .innerJoin(
            tenants,
            eq(agentCredentials.tenantId, tenants.id),
          )
          .innerJoin(
            developers,
            and(
              eq(agentCredentials.tenantId, developers.tenantId),
              eq(agentCredentials.developerId, developers.id),
            ),
          )
          .innerJoin(
            agents,
            and(
              eq(agentCredentials.tenantId, agents.tenantId),
              eq(agentCredentials.agentId, agents.id),
              eq(agentCredentials.developerId, agents.developerId),
            ),
          )
          .where(eq(agentCredentials.id, credentialId))
          .limit(1);

        if (!row) return null;

        return {
          ...row,
          tokenHash: Buffer.from(row.tokenHash),
          tenantStatus: row.tenantStatus as PersistedAgentCredential["tenantStatus"],
          developerStatus: row.developerStatus as PersistedAgentCredential["developerStatus"],
          agentStatus: row.agentStatus as PersistedAgentCredential["agentStatus"],
        };
      },
    );
  }

  async revoke(
    credentialId: string,
    tenantId: string,
    revokedAt: Date,
  ): Promise<void> {
    if (tenantId !== this.authenticatedTenantId) {
      throw new Error("Tenant context mismatch.");
    }

    await withTenantTransaction(
      this.database,
      this.authenticatedTenantId,
      async (tx) => {
        const rows = await tx.update(agentCredentials).set({ revokedAt }).where(and(
          eq(agentCredentials.id, credentialId),
          eq(agentCredentials.tenantId, this.authenticatedTenantId),
          isNull(agentCredentials.revokedAt)
        )).returning({ agentId: agentCredentials.agentId });
        if (rows[0]) {
          await tx.insert(auditEvents).values({
            id: credentialId + "_revoked_" + revokedAt.getTime(), tenantId: this.authenticatedTenantId,
            actorType: "system", actorId: "agent_credential_service",
            eventType: "agent_credential.revoked", resourceRef: credentialId,
            decision: "revoked", metadata: { agent_ref: rows[0].agentId }
          });
        }
      },
    );
  }
}
