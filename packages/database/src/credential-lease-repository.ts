import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import { credentialLeases, credentials, connectedAccounts, grants } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

export type CredentialLeaseBinding = {
  tenantId: string; userId: string; agentId: string; grantId: string;
  accountId: string; credentialRef: string; credentialId: string;
  recordVersion: number; origin: string; executionId: string; expiresAt: Date;
};

export type IssuedCredentialLease = { leaseId: string; token: string; expiresAt: Date };

export function hashCredentialLeaseToken(token: string): Buffer {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new TypeError("Invalid credential lease token.");
  }
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * Tenant-bound one-time lease storage. Only a SHA-256 token digest is stored.
 * consume() returns an internal credential reference, never decrypted material.
 */
export class PostgresCredentialLeaseRepository {
  constructor(
    private readonly database: Database,
    private readonly authenticatedTenantId: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!authenticatedTenantId || authenticatedTenantId.trim() !== authenticatedTenantId || authenticatedTenantId.length > 200) {
      throw new TypeError("A verified tenant identity is required.");
    }
  }

  async issue(input: CredentialLeaseBinding): Promise<IssuedCredentialLease> {
    const now = this.now();
    const origin = new URL(input.origin);
    if (
      input.tenantId !== this.authenticatedTenantId ||
      origin.origin !== input.origin ||
      (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) ||
      !input.userId || !input.agentId || !input.grantId || !input.accountId ||
      !input.credentialRef || !input.credentialId || !input.executionId ||
      !Number.isSafeInteger(input.recordVersion) || input.recordVersion < 1 ||
      !(input.expiresAt instanceof Date) || input.expiresAt.getTime() <= now.getTime() ||
      input.expiresAt.getTime() > now.getTime() + 120_000
    ) {
      throw new TypeError("Invalid credential lease binding.");
    }

    const leaseId = "lease_" + randomBytes(18).toString("base64url");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashCredentialLeaseToken(token);
    await withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      await tx.insert(credentialLeases).values({
        id: leaseId, tenantId: this.authenticatedTenantId, tokenHash,
        userId: input.userId, agentId: input.agentId, grantId: input.grantId,
        accountId: input.accountId, credentialRef: input.credentialRef,
        credentialId: input.credentialId, recordVersion: input.recordVersion,
        origin: input.origin, executionId: input.executionId,
        expiresAt: input.expiresAt,
      });
    });
    return { leaseId, token, expiresAt: input.expiresAt };
  }

  /**
   * Called only after authenticating the internal browser worker. The caller
   * must construct this repository with tenant identity from a verified,
   * short-lived internal worker ticket, never from an untrusted body field.
   */
  async consume(input: { leaseId: string; token: string }): Promise<{
    credentialRef: string; credentialId: string; recordVersion: number;
    tenantId: string; userId: string; agentId: string; grantId: string;
    accountId: string; origin: string; executionId: string;
  } | null> {
    const tokenHash = hashCredentialLeaseToken(input.token);
    const now = this.now();
    return withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      const [row] = await tx.select({
        leaseId: credentialLeases.id, tenantId: credentialLeases.tenantId,
        userId: credentialLeases.userId, agentId: credentialLeases.agentId,
        grantId: credentialLeases.grantId, accountId: credentialLeases.accountId,
        credentialRef: credentialLeases.credentialRef, credentialId: credentialLeases.credentialId,
        recordVersion: credentialLeases.recordVersion, origin: credentialLeases.origin,
        executionId: credentialLeases.executionId,
      }).from(credentialLeases)
        .innerJoin(grants, and(
          eq(grants.tenantId, credentialLeases.tenantId),
          eq(grants.id, credentialLeases.grantId),
        ))
        .innerJoin(connectedAccounts, and(
          eq(connectedAccounts.tenantId, credentialLeases.tenantId),
          eq(connectedAccounts.id, credentialLeases.accountId),
          eq(connectedAccounts.userId, credentialLeases.userId),
          eq(connectedAccounts.origin, credentialLeases.origin),
          eq(connectedAccounts.status, "active"),
        ))
        .innerJoin(credentials, and(
          eq(credentials.tenantId, credentialLeases.tenantId),
          eq(credentials.id, credentialLeases.credentialRef),
          eq(credentials.accountId, credentialLeases.accountId),
          eq(credentials.credentialId, credentialLeases.credentialId),
          eq(credentials.recordVersion, credentialLeases.recordVersion),
          eq(credentials.credentialType, "website_login"),
          eq(credentials.status, "active"),
          isNull(credentials.revokedAt),
        ))
        .where(and(
          eq(credentialLeases.tenantId, this.authenticatedTenantId),
          eq(credentialLeases.id, input.leaseId),
          eq(credentialLeases.tokenHash, tokenHash),
          gt(credentialLeases.expiresAt, now),
          isNull(credentialLeases.consumedAt),
          isNull(credentialLeases.revokedAt),
          eq(grants.userId, credentialLeases.userId),
          eq(grants.agentId, credentialLeases.agentId),
          eq(grants.accountId, credentialLeases.accountId),
          eq(grants.origin, credentialLeases.origin),
          gt(grants.expiresAt, now),
          isNull(grants.revokedAt),
        ))
        .for("update")
        .limit(1);

      if (!row) return null;
      const [consumed] = await tx.update(credentialLeases)
        .set({ consumedAt: now })
        .where(and(
          eq(credentialLeases.tenantId, this.authenticatedTenantId),
          eq(credentialLeases.id, row.leaseId),
          eq(credentialLeases.tokenHash, tokenHash),
          isNull(credentialLeases.consumedAt),
          isNull(credentialLeases.revokedAt),
          gt(credentialLeases.expiresAt, now),
        ))
        .returning({ id: credentialLeases.id });
      if (!consumed) return null;
      return {
        credentialRef: row.credentialRef, credentialId: row.credentialId,
        recordVersion: row.recordVersion, tenantId: row.tenantId,
        userId: row.userId, agentId: row.agentId, grantId: row.grantId,
        accountId: row.accountId, origin: row.origin, executionId: row.executionId,
      };
    });
  }

  async revoke(leaseId: string): Promise<void> {
    await withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      await tx.update(credentialLeases).set({ revokedAt: this.now() }).where(and(
        eq(credentialLeases.tenantId, this.authenticatedTenantId),
        eq(credentialLeases.id, leaseId),
        isNull(credentialLeases.consumedAt),
        isNull(credentialLeases.revokedAt),
      ));
    });
  }
}
