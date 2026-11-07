import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { agents, auditEvents, connectedAccounts, delegations, developers, tenants, users } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

function newId(): string { return "del_" + randomBytes(18).toString("base64url"); }
export class PostgresDelegationRepository {
  constructor(private readonly database: Database, private readonly tenantId: string) {
    if (!tenantId || tenantId.trim() !== tenantId || tenantId.length > 200) throw new TypeError("A verified tenant identity is required.");
  }

  async create(input: { userId: string; agentId: string; accountId: string; scopes: string[] }): Promise<{ delegationId: string; created: boolean }> {
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const [allowed] = await tx.select({ accountId: connectedAccounts.id })
        .from(connectedAccounts)
        .innerJoin(users, and(eq(connectedAccounts.tenantId, users.tenantId), eq(connectedAccounts.userId, users.id)))
        .innerJoin(agents, eq(agents.tenantId, connectedAccounts.tenantId))
        .innerJoin(developers, and(eq(agents.tenantId, developers.tenantId), eq(agents.developerId, developers.id)))
        .innerJoin(tenants, eq(connectedAccounts.tenantId, tenants.id))
        .where(and(
          eq(connectedAccounts.tenantId, this.tenantId),
          eq(connectedAccounts.id, input.accountId),
          eq(connectedAccounts.userId, input.userId),
          eq(connectedAccounts.status, "active"),
          eq(users.status, "active"),
          eq(agents.id, input.agentId),
          eq(agents.status, "active"),
          eq(developers.status, "active"),
          eq(tenants.status, "active")
        )).limit(1);
      if (!allowed) throw new Error("The user, agent, and connected account are not all active in this tenant.");
      const delegationId = newId();
      const inserted = await tx.insert(delegations).values({
        id: delegationId, tenantId: this.tenantId, userId: input.userId,
        agentId: input.agentId, accountId: input.accountId,
        scopes: input.scopes, status: "active"
      }).onConflictDoNothing().returning({ id: delegations.id });
      if (!inserted[0]) {
        const [existing] = await tx.select({ id: delegations.id }).from(delegations).where(and(
          eq(delegations.tenantId, this.tenantId), eq(delegations.userId, input.userId),
          eq(delegations.agentId, input.agentId), eq(delegations.accountId, input.accountId),
          eq(delegations.status, "active")
        )).limit(1);
        if (existing) return { delegationId: existing.id, created: false };
        throw new Error("An inactive delegation already exists; revoke or replace it explicitly.");
      }
      await tx.insert(auditEvents).values({
        id: delegationId + "_created", tenantId: this.tenantId,
        actorType: "user", actorId: input.userId, eventType: "delegation.created",
        resourceRef: delegationId, decision: "allowed",
        metadata: { agent_ref: input.agentId, account_ref: input.accountId, scopes: input.scopes }
      });
      return { delegationId, created: true };
    });
  }

  async revoke(input: { delegationId: string; userId: string }): Promise<boolean> {
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const rows = await tx.update(delegations).set({ status: "revoked" }).where(and(
        eq(delegations.tenantId, this.tenantId), eq(delegations.id, input.delegationId),
        eq(delegations.userId, input.userId), eq(delegations.status, "active")
      )).returning({ id: delegations.id, agentId: delegations.agentId, accountId: delegations.accountId });
      const row = rows[0];
      if (!row) return false;
      await tx.insert(auditEvents).values({
        id: input.delegationId + "_revoked", tenantId: this.tenantId,
        actorType: "user", actorId: input.userId, eventType: "delegation.revoked",
        resourceRef: input.delegationId, decision: "revoked",
        metadata: { agent_ref: row.agentId, account_ref: row.accountId }
      });
      return true;
    });
  }
}
