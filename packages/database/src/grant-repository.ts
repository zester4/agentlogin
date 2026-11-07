import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { approvals, auditEvents, delegations, grants } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

export type NewGrantRecord = {
  id: string; tenantId: string; userId: string; agentId: string; accountId: string;
  origin: string; scopes: string[]; taskId: string | null; policyVersion: number;
  issuedAt: Date; expiresAt: Date;
};
export type GrantRecord = NewGrantRecord & {
  approvalId: string | null; revokedAt: Date | null; approvedAt: Date | null;
  approvalDecision: string | null;
};
export type NewApprovalRecord = {
  id: string; requestedBy: string; createdAt: Date;
};
export type ApprovalDecision = "approved" | "denied";

function requireTenant(tenantId: string): void {
  if (!tenantId || tenantId.trim() !== tenantId || tenantId.length > 200) {
    throw new TypeError("A verified tenant context is required.");
  }
}

/**
 * All methods run with transaction-local RLS context. This repository stores
 * authorization metadata only; it never loads credential ciphertext or
 * returns browser/session material.
 */
export class PostgresGrantRepository {
  constructor(private readonly database: Database, private readonly tenantId: string) {
    requireTenant(tenantId);
  }

  async hasActiveDelegation(input: { userId: string; agentId: string; accountId: string; scopes: string[] }): Promise<boolean> {
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const rows = await tx.select({ id: delegations.id }).from(delegations).where(and(
        eq(delegations.tenantId, this.tenantId),
        eq(delegations.userId, input.userId),
        eq(delegations.agentId, input.agentId),
        eq(delegations.accountId, input.accountId),
        eq(delegations.status, "active")
      )).limit(1);
      if (!rows[0]) return false;
      const [row] = await tx.select({ scopes: delegations.scopes }).from(delegations).where(and(
        eq(delegations.tenantId, this.tenantId), eq(delegations.id, rows[0].id)
      )).limit(1);
      return Boolean(row && input.scopes.every((scope) => row.scopes.includes(scope)));
    });
  }

  async createPending(input: NewGrantRecord & NewApprovalRecord): Promise<{ grantId: string; approvalId: string }> {
    if (input.tenantId !== this.tenantId) throw new Error("Tenant context mismatch.");
    if (input.expiresAt.getTime() <= input.issuedAt.getTime()) throw new TypeError("Grant expiry must be after issue time.");
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const approvalId = input.id + "_approval";
      await tx.insert(grants).values({
        id: input.id, tenantId: this.tenantId, userId: input.userId, agentId: input.agentId,
        accountId: input.accountId, origin: input.origin, scopes: input.scopes, taskId: input.taskId,
        policyVersion: input.policyVersion, issuedAt: input.issuedAt, expiresAt: input.expiresAt
      });
      await tx.insert(approvals).values({
        id: approvalId, tenantId: this.tenantId, grantId: input.id,
        requestedBy: input.requestedBy, decision: "pending", createdAt: input.createdAt
      });
      await tx.update(grants).set({ approvalId }).where(and(eq(grants.tenantId, this.tenantId), eq(grants.id, input.id)));
      await tx.insert(auditEvents).values({
        id: input.id + "_requested", tenantId: this.tenantId, actorType: "agent",
        actorId: input.agentId, eventType: "grant.requested", resourceRef: input.id,
        decision: "pending_approval", correlationId: input.taskId,
        metadata: { account_ref: input.accountId, origin: input.origin, scopes: input.scopes }
      });
      return { grantId: input.id, approvalId };
    });
  }

  async decide(input: { approvalId: string; userId: string; decision: ApprovalDecision; decidedAt: Date }): Promise<boolean> {
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const rows = await tx.update(approvals).set({
        decision: input.decision, decidedBy: input.userId, decidedAt: input.decidedAt
      }).where(and(
        eq(approvals.tenantId, this.tenantId),
        eq(approvals.id, input.approvalId),
        eq(approvals.decision, "pending"),
        isNull(approvals.decidedAt)
      )).returning({ grantId: approvals.grantId });
      const row = rows[0];
      if (!row) return false;
      await tx.insert(auditEvents).values({
        id: input.approvalId + "_" + input.decision, tenantId: this.tenantId,
        actorType: "user", actorId: input.userId, eventType: "grant.approval_decided",
        resourceRef: row.grantId, decision: input.decision,
        metadata: { approval_ref: input.approvalId }
      });
      return true;
    });
  }

  async find(grantId: string): Promise<GrantRecord | null> {
    if (!grantId) return null;
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const [row] = await tx.select({
        id: grants.id, tenantId: grants.tenantId, userId: grants.userId,
        agentId: grants.agentId, accountId: grants.accountId, origin: grants.origin,
        scopes: grants.scopes, taskId: grants.taskId, policyVersion: grants.policyVersion,
        issuedAt: grants.issuedAt, expiresAt: grants.expiresAt, revokedAt: grants.revokedAt,
        approvalId: grants.approvalId, approvedAt: approvals.decidedAt,
        approvalDecision: approvals.decision
      }).from(grants).leftJoin(approvals, and(
        eq(grants.tenantId, approvals.tenantId), eq(grants.approvalId, approvals.id)
      )).where(and(eq(grants.tenantId, this.tenantId), eq(grants.id, grantId))).limit(1);
      return row ?? null;
    });
  }

  async revoke(grantId: string, revokedAt: Date): Promise<boolean> {
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const rows = await tx.update(grants).set({ revokedAt }).where(and(
        eq(grants.tenantId, this.tenantId), eq(grants.id, grantId), isNull(grants.revokedAt)
      )).returning({ id: grants.id, agentId: grants.agentId, accountId: grants.accountId });
      const row = rows[0];
      if (!row) return false;
      await tx.insert(auditEvents).values({
        id: grantId + "_revoked_" + revokedAt.getTime(), tenantId: this.tenantId,
        actorType: "user", actorId: "system", eventType: "grant.revoked",
        resourceRef: grantId, decision: "revoked",
        metadata: { agent_ref: row.agentId, account_ref: row.accountId }
      });
      return true;
    });
  }
}
