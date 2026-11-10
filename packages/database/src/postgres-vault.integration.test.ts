import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  PostgresConnectedAccountRepository,
  PostgresCredentialRecordStore,
  tenants,
  users,
  connectedAccounts,
  credentials,
  auditEvents,
  webhookEvents
} from "./index.js";
import {
  CredentialDecryptionError,
  EncryptedCredentialVault,
  type CredentialContext,
  type KeyManagementProvider,
  type WrappedDataKey
} from "@agentlogin/vault";

const connectionString = process.env.TEST_DATABASE_URL;

class TestKeyManagementProvider implements KeyManagementProvider {
  private readonly masterKey = randomBytes(32);
  private readonly keyVersion = "ci-test-kms-key-v1";

  async wrapKey(dek: Uint8Array, context: CredentialContext): Promise<WrappedDataKey> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(context), "utf8"));
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    const wrappedDek = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    return { wrappedDek: new Uint8Array(wrappedDek), keyVersion: this.keyVersion };
  }

  async unwrapKey(wrappedDek: Uint8Array, keyVersion: string, context: CredentialContext): Promise<Uint8Array> {
    if (keyVersion !== this.keyVersion || wrappedDek.byteLength !== 60) {
      throw new Error("Test key management rejected the wrapped key.");
    }
    const input = Buffer.from(wrappedDek);
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, input.subarray(0, 12));
    decipher.setAAD(Buffer.from(JSON.stringify(context), "utf8"));
    decipher.setAuthTag(input.subarray(12, 28));
    return new Uint8Array(Buffer.concat([decipher.update(input.subarray(28)), decipher.final()]));
  }
}

describe.skipIf(!connectionString)("PostgreSQL credential vault lifecycle (isolated CI KMS boundary)", () => {
  const runId = randomBytes(8).toString("hex");
  const tenantId = "vault-ci-tenant-" + runId;
  const userId = "vault-ci-user-" + runId;
  const syntheticPassword = "agentlogin-synthetic-vault-check-only-" + runId;

  let databaseHandle: ReturnType<typeof createDatabase> | undefined;
  let accountId = "";
  let vault: EncryptedCredentialVault | undefined;
  let records: PostgresCredentialRecordStore | undefined;

  beforeAll(async () => {
    if (!connectionString) throw new Error("TEST_DATABASE_URL is required.");
    databaseHandle = createDatabase(connectionString);

    await databaseHandle.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      await tx.insert(tenants).values({ id: tenantId, name: "Synthetic vault CI tenant" });
      await tx.insert(users).values({
        id: userId,
        tenantId,
        authSubject: "vault-ci-subject-" + runId,
        status: "active"
      });
    });

    const accounts = new PostgresConnectedAccountRepository(databaseHandle.db, tenantId);
    ({ accountId } = await accounts.create({
      userId,
      provider: "agentlogin-vault-integration-test",
      origin: "https://vault-integration.invalid",
      displayLabel: "Temporary synthetic AgentLogin vault test account"
    }));
    records = new PostgresCredentialRecordStore(databaseHandle.db, tenantId);
    vault = new EncryptedCredentialVault(records, new TestKeyManagementProvider());
  }, 30_000);

  afterAll(async () => {
    if (databaseHandle) {
      await databaseHandle.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
        if (accountId) {
          await tx.delete(webhookEvents).where(eq(webhookEvents.tenantId, tenantId));
          await tx.delete(credentials).where(eq(credentials.tenantId, tenantId));
          await tx.delete(connectedAccounts).where(eq(connectedAccounts.id, accountId));
        }
        await tx.delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
        await tx.delete(users).where(eq(users.id, userId));
        await tx.delete(tenants).where(eq(tenants.id, tenantId));
      });
      await databaseHandle.close();
    }
  }, 30_000);

  it("stores ciphertext, decrypts only inside the callback, rotates, revokes, and isolates tenants", async () => {
    const firstContext = {
      tenantId,
      accountId,
      credentialId: "vcred_integration_v1_" + runId,
      recordVersion: 1,
      purpose: "website_login" as const
    };
    const firstPlaintext = Buffer.from(JSON.stringify({
      username: "synthetic-user@vault-integration.invalid",
      password: syntheticPassword
    }));

    const first = await vault!.store(firstContext, firstPlaintext);
    firstPlaintext.fill(0);

    const persisted = await records!.find(first.credentialRef, tenantId, firstContext.credentialId);
    expect(persisted).not.toBeNull();
    expect(persisted?.envelope.algorithm).toBe("AES-256-GCM");
    expect(persisted?.envelope.iv).toHaveLength(12);
    expect(persisted?.envelope.authTag).toHaveLength(16);
    expect(persisted?.envelope.wrappedDek.byteLength).toBeGreaterThan(0);
    expect(persisted?.envelope.keyVersion).toBe("ci-test-kms-key-v1");
    expect(Buffer.from(persisted!.envelope.ciphertext).includes(Buffer.from(syntheticPassword))).toBe(false);
    expect(Buffer.from(persisted!.envelope.wrappedDek).includes(Buffer.from(syntheticPassword))).toBe(false);

    let callbackBuffer: Uint8Array | undefined;
    const recovered = await vault!.withDecryptedCredential(
      first.credentialRef,
      firstContext,
      async (secret) => {
        callbackBuffer = secret;
        return JSON.parse(Buffer.from(secret).toString("utf8")) as { username: string; password: string };
      }
    );
    expect(recovered).toEqual({
      username: "synthetic-user@vault-integration.invalid",
      password: syntheticPassword
    });
    expect(callbackBuffer?.every((byte) => byte === 0)).toBe(true);
    expect(await records!.find(first.credentialRef, "ten_wrong_tenant", firstContext.credentialId)).toBeNull();

    const secondContext = {
      ...firstContext,
      credentialId: "vcred_integration_v2_" + runId,
      recordVersion: 2
    };
    const secondPlaintext = Buffer.from(JSON.stringify({
      username: "synthetic-user@vault-integration.invalid",
      password: syntheticPassword + "-rotated"
    }));
    const second = await vault!.rotate(first.credentialRef, firstContext, secondContext, secondPlaintext);
    secondPlaintext.fill(0);

    await expect(vault!.withDecryptedCredential(first.credentialRef, firstContext, async () => "must-not-run"))
      .rejects.toBeInstanceOf(CredentialDecryptionError);
    await expect(vault!.withDecryptedCredential(second.credentialRef, secondContext, async (secret) => {
      const parsed = JSON.parse(Buffer.from(secret).toString("utf8")) as { password: string };
      return parsed.password;
    })).resolves.toBe(syntheticPassword + "-rotated");

    await vault!.revoke(second.credentialRef, secondContext);
    await expect(vault!.withDecryptedCredential(second.credentialRef, secondContext, async () => "must-not-run"))
      .rejects.toBeInstanceOf(CredentialDecryptionError);

    const disconnected = await new PostgresConnectedAccountRepository(databaseHandle!.db, tenantId)
      .disconnect(accountId, userId);
    expect(disconnected).toBe(true);
    expect(await records!.find(second.credentialRef, tenantId, secondContext.credentialId)).toBeNull();
  }, 60_000);
});
