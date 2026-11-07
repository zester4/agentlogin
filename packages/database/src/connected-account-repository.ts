import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { auditEvents, connectedAccounts } from "./schema.js";
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
