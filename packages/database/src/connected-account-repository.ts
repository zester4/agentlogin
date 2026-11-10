import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { auditEvents, connectedAccounts, credentials, delegations, grants } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";
import { enqueueWebhookEvent } from "./webhook-repository.js";

function newId(): string { return "acct_" + randomBytes(18).toString("base64url"); }
export class PostgresConnectedAccountRepository {
  constructor(private readonly database: Database, private readonly tenantId: string) {
    if (!tenantId || tenantId.trim() !== tenantId || tenantId.length > 200) throw new TypeError("A verified tenant identity is required.");
  }

  async listForUser(userId: string) {
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      return tx.select({
        accountId: connectedAccounts.id,
        provider: connectedAccounts.provider,
        origin: connectedAccounts.origin,
        displayLabel: connectedAccounts.displayLabel,
        status: connectedAccounts.status,
        createdAt: connectedAccounts.createdAt
      }).from(connectedAccounts).where(and(
        eq(connectedAccounts.tenantId, this.tenantId),
        eq(connectedAccounts.userId, userId)
      )).orderBy(connectedAccounts.createdAt);
    });
  }

  async create(input: { userId: string; provider: string; origin: string; displayLabel: string }): Promise<{ accountId: string }> {
    const accountId = newId();
    await withTenantTransaction(this.database, this.tenantId, async (tx) => {
      await tx.insert(connectedAccounts).values({
        id: accountId, tenantId: this.tenantId, userId: input.userId,
        provider: input.provider, origin: input.origin,
        displayLabel: input.displayLabel, status: "pending"
      });
      await tx.insert(auditEvents).values({
        id: accountId + "_created", tenantId: this.tenantId,
        actorType: "user", actorId: input.userId,
        eventType: "connected_account.created", resourceRef: accountId,
        decision: "created", metadata: { provider: input.provider, origin: input.origin }
      });
      await enqueueWebhookEvent(tx, { tenantId: this.tenantId, eventType: "connected_account.created",
        resourceType: "connected_account", resourceId: accountId,
        payload: { account_id: accountId, provider: input.provider, origin: input.origin } });
    });
    return { accountId };
  }

  async disconnect(accountId: string, userId: string, at: Date = new Date()): Promise<boolean> {
    return withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const rows = await tx.update(connectedAccounts).set({ status: "disabled" }).where(and(
        eq(connectedAccounts.tenantId, this.tenantId),
        eq(connectedAccounts.id, accountId),
        eq(connectedAccounts.userId, userId),
        inArray(connectedAccounts.status, ["active", "pending"])
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
      const revokedGrants = await tx.update(grants).set({ revokedAt: at }).where(and(
        eq(grants.tenantId, this.tenantId), eq(grants.accountId, accountId),
        isNull(grants.revokedAt)
      )).returning({ id: grants.id, agentId: grants.agentId, accountId: grants.accountId });
      await tx.insert(auditEvents).values({
        id: accountId + "_disconnected_" + at.getTime(), tenantId: this.tenantId,
        actorType: "user", actorId: userId, eventType: "connected_account.disconnected",
        resourceRef: accountId, decision: "revoked",
        metadata: { credentials_revoked: true, delegations_revoked: true, grants_revoked: true }
      });
      await enqueueWebhookEvent(tx, { tenantId: this.tenantId, eventType: "connected_account.disconnected",
        resourceType: "connected_account", resourceId: accountId, occurredAt: at,
        payload: { account_id: accountId, disconnected_at: at.toISOString(),
          credentials_revoked: true, delegations_revoked: true, grants_revoked: true } });
      for (const grant of revokedGrants) {
        await enqueueWebhookEvent(tx, { tenantId: this.tenantId, eventType: "grant.revoked",
          resourceType: "grant", resourceId: grant.id, occurredAt: at,
          payload: { grant_id: grant.id, account_id: grant.accountId, agent_id: grant.agentId,
            revoked_at: at.toISOString(), reason: "connected_account_disconnected" } });
      }
      return true;
    });
  }

  async disable(accountId: string, userId: string): Promise<void> {
    await withTenantTransaction(this.database, this.tenantId, async (tx) => {
      const rows = await tx.update(connectedAccounts).set({ status: "disabled" }).where(and(
        eq(connectedAccounts.tenantId, this.tenantId),
        eq(connectedAccounts.id, accountId), eq(connectedAccounts.userId, userId),
        inArray(connectedAccounts.status, ["active", "pending"])
      )).returning({ id: connectedAccounts.id });
      if (!rows[0]) return;
      await tx.insert(auditEvents).values({
        id: accountId + "_disabled_" + Date.now(), tenantId: this.tenantId,
        actorType: "user", actorId: userId,
        eventType: "connected_account.disabled", resourceRef: accountId,
        decision: "disabled", metadata: {}
      });
      await enqueueWebhookEvent(tx, { tenantId: this.tenantId, eventType: "connected_account.disabled",
        resourceType: "connected_account", resourceId: accountId,
        payload: { account_id: accountId, disabled_by: userId } });
    });
  }
}
