import { and, eq } from "drizzle-orm";
import type { CredentialRecordStore, StoredCredential } from "@agentlogin/vault";
import type { Database } from "./client.js";
import { connectedAccounts, credentials } from "./schema.js";
import { withTenantTransaction } from "./tenant.js";

/**
 * Tenant-bound PostgreSQL adapter for encrypted vault records. The row stores
 * only ciphertext, IV, GCM tag, wrapped DEK, key version, and non-secret
 * references. It never returns plaintext and never performs global lookups.
 */
export class PostgresCredentialRecordStore implements CredentialRecordStore {
  constructor(private readonly database: Database, private readonly authenticatedTenantId: string) {
    if (!authenticatedTenantId || authenticatedTenantId.trim() !== authenticatedTenantId || authenticatedTenantId.length > 200) {
      throw new TypeError("A verified tenant identity is required.");
    }
  }

  async insert(record: StoredCredential): Promise<void> {
    const { context, envelope } = record;
    if (context.tenantId !== this.authenticatedTenantId) throw new Error("Tenant context mismatch.");
    if (record.revokedAt !== null) throw new TypeError("New credential records must be active.");
    if (!record.credentialRef || !context.accountId || !context.credentialId ||
        envelope.algorithm !== "AES-256-GCM" || envelope.iv.byteLength !== 12 ||
        envelope.authTag.byteLength !== 16 || envelope.wrappedDek.byteLength === 0 ||
        envelope.ciphertext.byteLength === 0 || !envelope.keyVersion || envelope.aadVersion !== 1) {
      throw new TypeError("Invalid encrypted credential record.");
    }
    await withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      await tx.insert(credentials).values({
        id: record.credentialRef, tenantId: this.authenticatedTenantId,
        accountId: context.accountId, credentialId: context.credentialId,
        credentialType: context.purpose, ciphertext: Buffer.from(envelope.ciphertext),
        iv: Buffer.from(envelope.iv), authTag: Buffer.from(envelope.authTag),
        wrappedDek: Buffer.from(envelope.wrappedDek), keyVersion: envelope.keyVersion,
        recordVersion: context.recordVersion, status: "active", revokedAt: null
      });
    });
  }

  async rotate(
    previousCredentialRef: string,
    previousContext: StoredCredential["context"],
    record: StoredCredential,
    revokedAt: Date
  ): Promise<void> {
    const { context, envelope } = record;
    if (previousContext.tenantId !== this.authenticatedTenantId ||
        context.tenantId !== this.authenticatedTenantId ||
        previousContext.accountId !== context.accountId ||
        previousContext.purpose !== context.purpose ||
        previousContext.credentialId === context.credentialId ||
        context.recordVersion !== previousContext.recordVersion + 1 ||
        record.revokedAt !== null || envelope.algorithm !== "AES-256-GCM" ||
        envelope.iv.byteLength !== 12 || envelope.authTag.byteLength !== 16 ||
        envelope.wrappedDek.byteLength === 0 || envelope.ciphertext.byteLength === 0 ||
        !envelope.keyVersion || envelope.aadVersion !== 1) {
      throw new TypeError("Invalid credential rotation record.");
    }
    await withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      const [account] = await tx.select({ id: connectedAccounts.id }).from(connectedAccounts).where(and(
        eq(connectedAccounts.tenantId, this.authenticatedTenantId),
        eq(connectedAccounts.id, context.accountId),
        eq(connectedAccounts.status, "active")
      )).for("update").limit(1);
      if (!account) throw new Error("Connected account is not active.");
      const previous = await tx.update(credentials).set({
        status: "revoked", revokedAt
      }).where(and(
        eq(credentials.id, previousCredentialRef),
        eq(credentials.tenantId, this.authenticatedTenantId),
        eq(credentials.accountId, previousContext.accountId),
        eq(credentials.credentialId, previousContext.credentialId),
        eq(credentials.recordVersion, previousContext.recordVersion),
        eq(credentials.status, "active")
      )).returning({ id: credentials.id });
      if (!previous[0]) throw new Error("Previous credential is no longer active.");
      await tx.insert(credentials).values({
        id: record.credentialRef, tenantId: this.authenticatedTenantId,
        accountId: context.accountId, credentialId: context.credentialId,
        credentialType: context.purpose, ciphertext: Buffer.from(envelope.ciphertext),
        iv: Buffer.from(envelope.iv), authTag: Buffer.from(envelope.authTag),
        wrappedDek: Buffer.from(envelope.wrappedDek), keyVersion: envelope.keyVersion,
        recordVersion: context.recordVersion, status: "active", revokedAt: null
      });
      await tx.insert(auditEvents).values({
        id: record.credentialRef + "_rotated", tenantId: this.authenticatedTenantId,
        actorType: "system", actorId: "credential_vault",
        eventType: "credential.rotated", resourceRef: record.credentialRef,
        decision: "rotated",
        metadata: {
          account_ref: context.accountId, previous_credential_ref: previousCredentialRef,
          record_version: context.recordVersion
        }
      });
    });
  }

  async find(credentialRef: string, tenantId: string, credentialId: string): Promise<StoredCredential | null> {
    if (!credentialRef || tenantId !== this.authenticatedTenantId || !credentialId) return null;
    return withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      const [row] = await tx.select({
        id: credentials.id, tenantId: credentials.tenantId, accountId: credentials.accountId,
        credentialId: credentials.credentialId, credentialType: credentials.credentialType,
        ciphertext: credentials.ciphertext, iv: credentials.iv, authTag: credentials.authTag,
        wrappedDek: credentials.wrappedDek, keyVersion: credentials.keyVersion,
        recordVersion: credentials.recordVersion, status: credentials.status, revokedAt: credentials.revokedAt,
        accountStatus: connectedAccounts.status
      }).from(credentials).innerJoin(connectedAccounts, and(
        eq(credentials.tenantId, connectedAccounts.tenantId),
        eq(credentials.accountId, connectedAccounts.id)
      )).where(and(
        eq(credentials.id, credentialRef), eq(credentials.tenantId, this.authenticatedTenantId),
        eq(credentials.credentialId, credentialId)
      )).limit(1);
      if (!row || row.status !== "active" || row.accountStatus !== "active" || row.revokedAt !== null || !row.iv || !row.authTag || !row.credentialId ||
          !["website_login", "oauth_token", "api_key"].includes(row.credentialType)) return null;
      return {
        credentialRef: row.id,
        context: {
          tenantId: row.tenantId, accountId: row.accountId, credentialId: row.credentialId,
          recordVersion: row.recordVersion,
          purpose: row.credentialType as StoredCredential["context"]["purpose"]
        },
        envelope: {
          algorithm: "AES-256-GCM", aadVersion: 1,
          ciphertext: new Uint8Array(row.ciphertext), iv: new Uint8Array(row.iv),
          authTag: new Uint8Array(row.authTag), wrappedDek: new Uint8Array(row.wrappedDek),
          keyVersion: row.keyVersion
        },
        revokedAt: row.revokedAt
      };
    });
  }

  async revoke(credentialRef: string, tenantId: string, credentialId: string, revokedAt: Date): Promise<void> {
    if (tenantId !== this.authenticatedTenantId) throw new Error("Tenant context mismatch.");
    await withTenantTransaction(this.database, this.authenticatedTenantId, async (tx) => {
      await tx.update(credentials).set({ status: "revoked", revokedAt }).where(and(
        eq(credentials.id, credentialRef), eq(credentials.tenantId, this.authenticatedTenantId),
        eq(credentials.credentialId, credentialId), eq(credentials.status, "active")
      ));
    });
  }
}
