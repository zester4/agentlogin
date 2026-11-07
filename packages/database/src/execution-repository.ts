import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { auditEvents, connectedAccounts, credentials, executions } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

/** Tenant-scoped account credential lookup and secret-free execution audit. */
export class PostgresExecutionRepository {
  constructor(private readonly database: Database, private readonly authenticatedTenantId: string) {
    if (!authenticatedTenantId || authenticatedTenantId.trim() !== authenticatedTenantId || authenticatedTenantId.length > 200) {
      throw new TypeError("A verified tenant identity is required.");
    }
  }

  async findLoginCredential(input: { tenantId: string; accountId: string; userId: string }) {
    if (input.tenantId !== this.authenticatedTenantId) throw new Error("Tenant context mismatch.");
    return withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      const [row] = await tx.select({
        credentialRef: credentials.id, credentialId: credentials.credentialId,
        recordVersion: credentials.recordVersion, origin: connectedAccounts.origin,
        credentialStatus: credentials.status, accountStatus: connectedAccounts.status
      }).from(connectedAccounts).innerJoin(credentials, and(
        eq(credentials.tenantId, connectedAccounts.tenantId),
        eq(credentials.accountId, connectedAccounts.id)
      )).where(and(
        eq(connectedAccounts.tenantId, this.authenticatedTenantId),
        eq(connectedAccounts.id, input.accountId),
        eq(connectedAccounts.userId, input.userId),
        eq(connectedAccounts.status, "active"),
        eq(credentials.credentialType, "website_login"),
        eq(credentials.status, "active"),
        isNull(credentials.revokedAt)
      )).limit(1);
      if (!row || !row.credentialId) return null;
      return {
        credentialRef: row.credentialRef, credentialId: row.credentialId,
        recordVersion: row.recordVersion, origin: row.origin,
        status: row.credentialStatus === "active" && row.accountStatus === "active" ? "active" as const : "disabled" as const
      };
    });
  }

  async append(input: {
    executionId: string; tenantId: string; agentId: string; grantId: string;
    accountId: string; origin: string; status: string; reasonCode?: string;
    startedAt: Date; completedAt: Date;
  }): Promise<void> {
    if (input.tenantId !== this.authenticatedTenantId) throw new Error("Tenant context mismatch.");
    await withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      await tx.insert(executions).values({
        id: input.executionId, tenantId: this.authenticatedTenantId,
        grantId: input.grantId, operation: "autofill_login",
        status: input.status, safeResultCode: input.reasonCode ?? null,
        startedAt: input.startedAt, completedAt: input.completedAt
      });
      await tx.insert(auditEvents).values({
        id: input.executionId + "_audit", tenantId: this.authenticatedTenantId,
        actorType: "agent", actorId: input.agentId,
        eventType: "execution.completed", resourceRef: input.executionId,
        decision: input.status, correlationId: input.grantId,
        metadata: {
          grant_ref: input.grantId, account_ref: input.accountId,
          origin: input.origin, ...(input.reasonCode ? { reason_code: input.reasonCode } : {})
        }
      });
    });
  }
}
