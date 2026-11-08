import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, PostgresConnectedAccountRepository, PostgresCredentialRecordStore } from "./index.js";
import { AwsKmsProvider, CredentialDecryptionError, EncryptedCredentialVault } from "@agentlogin/vault";

const enabled = process.env.AGENTLOGIN_VAULT_INTEGRATION === "1";

describe.skipIf(!enabled)("production-shaped PostgreSQL + AWS KMS vault lifecycle", () => {
  const tenantId = process.env.AGENTLOGIN_TEST_TENANT_ID ?? "";
  const userId = process.env.AGENTLOGIN_TEST_USER_ID ?? "";
  const keyId = process.env.AWS_KMS_KEY_ID ?? "";
  const region = process.env.AWS_REGION ?? "";
  const syntheticPassword = "agentlogin-synthetic-vault-check-only-7d2f9c";

  let databaseHandle: ReturnType<typeof createDatabase> | undefined;
  let accountId = "";
  let vault: EncryptedCredentialVault | undefined;
  let records: PostgresCredentialRecordStore | undefined;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !tenantId || !userId || !keyId || !region) {
      throw new Error(
        "Set DATABASE_URL, AGENTLOGIN_TEST_TENANT_ID, AGENTLOGIN_TEST_USER_ID, AWS_KMS_KEY_ID, and AWS_REGION."
      );
    }
    databaseHandle = createDatabase();
    const accounts = new PostgresConnectedAccountRepository(databaseHandle.db, tenantId);
    ({ accountId } = await accounts.create({
      userId,
      provider: "agentlogin-vault-integration-test",
      origin: "https://vault-integration.invalid",
      displayLabel: "Temporary AgentLogin vault integration test"
    }));
    records = new PostgresCredentialRecordStore(databaseHandle.db, tenantId);
    vault = new EncryptedCredentialVault(records, new AwsKmsProvider(keyId, region));
  }, 30_000);

  afterAll(async () => {
    if (databaseHandle && accountId) {
      await new PostgresConnectedAccountRepository(databaseHandle.db, tenantId)
        .disconnect(accountId, userId)
        .catch(() => false);
    }
    await databaseHandle?.close();
  }, 30_000);

  it("stores ciphertext, unwraps only in callback, rotates, and rejects revoked credentials", async () => {
    const firstContext = {
      tenantId,
      accountId,
      credentialId: "vcred_integration_v1",
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
    expect(persisted?.envelope.keyVersion).toContain(":key/");
    expect(Buffer.from(persisted!.envelope.ciphertext).includes(Buffer.from(syntheticPassword))).toBe(false);
    expect(Buffer.from(persisted!.envelope.wrappedDek).includes(Buffer.from(syntheticPassword))).toBe(false);

    let callbackBuffer: Uint8Array | undefined;
    const recovered = await vault!.withDecryptedCredential(
      first.credentialRef,
      firstContext,
      async (secret) => {
        callbackBuffer = secret;
        const parsed = JSON.parse(Buffer.from(secret).toString("utf8")) as { username: string; password: string };
        return parsed;
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
      credentialId: "vcred_integration_v2",
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
    await expect(vault.withDecryptedCredential(second.credentialRef, secondContext, async (secret) => {
      const parsed = JSON.parse(Buffer.from(secret).toString("utf8")) as { password: string };
      return parsed.password;
    })).resolves.toBe(syntheticPassword + "-rotated");

    await vault!.revoke(second.credentialRef, secondContext);
    await expect(vault.withDecryptedCredential(second.credentialRef, secondContext, async () => "must-not-run"))
      .rejects.toBeInstanceOf(CredentialDecryptionError);
  }, 60_000);
});
