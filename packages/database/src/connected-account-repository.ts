import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { auditEvents, connectedAccounts, credentials, delegations, grants } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

function newId(): string { return "acct_" + randomBytes(18).toString("base64url"); }
export class PostgresConnectedAccountRepository {
  constructor(private readonly database: Database, private readonly tenantId: string) {
    if (!tenantId || tenantId.trim() !== tenantId || tenantId.length > 200) throw new TypeError("A verified tenant identity is required.");
  }

  async create(input: { userId: string; provider: string; origin: string; displayLabel: string }): Promise<{ accountId: string }> {
    const accountId = newId();
    await withTenantTransaction(this.database, this.tenantId, async (tx) => {
      await tx.insert(connectedAccounts).values({
        id: accountId, tenantId: this.tenantId, userId: input.userId,
        provider: input.provider, origin: input.origin,
        displayLabel: input.displayLabel, status: "active"
      });
      await tx.insert(auditEvents).values({
        id: accountId + "_created", tenantId: this.tenantId,
        actorType: "user", actorId: input.userId,
        eventType: "connected_account.created", resourceRef: accountId,
        decision: "created", metadata: { provider: input.provider, origin: input.origin }
      });
    });
    return { accountId };
  }

  async disconnect(accountId: string, userId: string, at: Date = new Date()): Promise<boolean> {
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const rows = await tx.update(connectedAccounts).set({ status: "disabled" }).where(and(
        eq(connectedAccounts.tenantId, this.tenantId),
        eq(connectedAccounts.id, accountId),
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.status, "active")
      )).returning({ id: connectedAccounts.id });
      if (!rows[0]) return false;
      await tx.update(credentials).set({ status: "revoked", revokedAt: at }).where(and(
        eq(credentials.tenantId, this.tenantId), eq(credentials.accountId, accountId),
        eq(credentials.status, "active")
      ));
      await tx.update(delegations).set({ status: "revoked" }).where(and(
        eq(delegations.tenantId, this.tenantId), eq(delegations.accountId, accountId),
        eq(delegations.status, "active")
      ));
      await tx.update(grants).set({ revokedAt: at }).where(and(
        eq(grants.tenantId, this.tenantId), eq(grants.accountId, accountId),
        isNull(grants.revokedAt)
      ));
      await tx.insert(auditEvents).values({
        id: accountId + "_disconnected_" + at.getTime(), tenantId: this.tenantId,
        actorType: "user", actorId: userId, eventType: "connected_account.disconnected",
        resourceRef: accountId, decision: "revoked",
        metadata: { credentials_revoked: true, delegations_revoked: true, grants_revoked: true }
      });
      return true;
    });
  }

  async disable(accountId: string, userId: string): Promise<void> {
    await withTenantTransaction(this.database, this.tenantId, async (tx) => {
      await tx.update(connectedAccounts).set({ status: "disabled" }).where(and(
        eq(connectedAccounts.tenantId, this.tenantId),
        eq(connectedAccounts.id, accountId), eq(connectedAccounts.userId, userId)
      ));
      await tx.insert(auditEvents).values({
        id: accountId + "_disabled_" + Date.now(), tenantId: this.tenantId,
        actorType: "user", actorId: userId,
        eventType: "connected_account.disabled", resourceRef: accountId,
        decision: "disabled", metadata: {}
      });
    });
  }
}
