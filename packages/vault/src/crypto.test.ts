import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CredentialContext, CredentialRecordStore, KeyManagementProvider, StoredCredential, WrappedDataKey } from "./index.js";
import { CredentialDecryptionError, EncryptedCredentialVault, decryptCredential, encryptCredential } from "./crypto.js";

const context: CredentialContext = {
  tenantId: "ten_test", accountId: "acct_test", credentialId: "cred_record_1", recordVersion: 1, purpose: "website_login"
};

class TestKeyManagement implements KeyManagementProvider {
  private readonly masterKey = randomBytes(32);
  async wrapKey(dek: Uint8Array, c: CredentialContext): Promise<WrappedDataKey> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    cipher.setAAD(Buffer.from(c.tenantId));
    const encrypted = Buffer.concat([cipher.update(Buffer.from(dek)), cipher.final()]);
    return { wrappedDek: Buffer.concat([iv, cipher.getAuthTag(), encrypted]), keyVersion: "test-master-v1" };
  }
  async unwrapKey(wrapped: Uint8Array, version: string, c: CredentialContext): Promise<Uint8Array> {
    if (version !== "test-master-v1" || wrapped.byteLength < 60) throw new Error("Invalid test wrapped key.");
    const bytes = Buffer.from(wrapped);
    const decipher = createDecipheriv("aes-256-gcm", this.masterKey, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(c.tenantId));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  }
}

class MemoryRecords implements CredentialRecordStore {
  readonly records = new Map<string, StoredCredential>();
  async insert(record: StoredCredential): Promise<void> { this.records.set(record.credentialRef, record); }
  async rotate(ref: string, previousContext: CredentialContext, record: StoredCredential, at: Date): Promise<void> {
    const previous = await this.find(ref, previousContext.tenantId, previousContext.credentialId);
    if (!previous || previous.revokedAt !== null) throw new Error("Previous credential is unavailable.");
    previous.revokedAt = at;
    await this.insert(record);
  }
  async find(ref: string, tenant: string, id: string): Promise<StoredCredential | null> {
    const record = this.records.get(ref);
    return record?.context.tenantId === tenant && record.context.credentialId === id ? record : null;
  }
  async revoke(ref: string, tenant: string, id: string, at: Date): Promise<void> {
    const record = await this.find(ref, tenant, id);
    if (record) record.revokedAt = at;
  }
}

describe("encrypted credential vault", () => {
  it("round-trips only inside the callback and zeroes the temporary buffer", async () => {
    const records = new MemoryRecords();
    const vault = new EncryptedCredentialVault(records, new TestKeyManagement(), () => "cred_ref_test");
    const plaintext = Buffer.from("synthetic-password-123");
    const stored = await vault.store(context, plaintext);
    const envelope = records.records.get(stored.credentialRef)!.envelope;
    expect(Buffer.from(envelope.ciphertext).includes(plaintext)).toBe(false);
    let callbackBuffer: Uint8Array | undefined;
    const result = await vault.withDecryptedCredential(stored.credentialRef, context, async (secret) => {
      callbackBuffer = secret;
      return Buffer.from(secret).toString("utf8");
    });
    expect(result).toBe("synthetic-password-123");
    expect(callbackBuffer?.every((byte) => byte === 0)).toBe(true);
  });

  it("rotates encrypted records and revokes the previous version atomically", async () => {
    const records = new MemoryRecords();
    const vault = new EncryptedCredentialVault(records, new TestKeyManagement(), (() => {
      let n = 0; return () => "cred_ref_" + (++n);
    })());
    const oldContext = context;
    const old = await vault.store(oldContext, Buffer.from("old-password"));
    const nextContext: CredentialContext = {
      ...oldContext, credentialId: "cred_record_2", recordVersion: 2
    };
    const rotated = await vault.rotate(old.credentialRef, oldContext, nextContext, Buffer.from("new-password"));
    await expect(vault.withDecryptedCredential(old.credentialRef, oldContext, async () => "bad"))
      .rejects.toBeInstanceOf(CredentialDecryptionError);
    await expect(vault.withDecryptedCredential(rotated.credentialRef, nextContext, async (secret) => Buffer.from(secret).toString("utf8")))
      .resolves.toBe("new-password");
  });

  it("rejects cross-tenant reads", async () => {
    const vault = new EncryptedCredentialVault(new MemoryRecords(), new TestKeyManagement());
    const stored = await vault.store(context, Buffer.from("synthetic-secret"));
    await expect(vault.withDecryptedCredential(stored.credentialRef, { ...context, tenantId: "ten_other" }, async () => "no"))
      .rejects.toBeInstanceOf(CredentialDecryptionError);
  });

  it("rejects a changed purpose through authenticated AAD", async () => {
    const vault = new EncryptedCredentialVault(new MemoryRecords(), new TestKeyManagement());
    const stored = await vault.store(context, Buffer.from("synthetic-secret"));
    await expect(vault.withDecryptedCredential(stored.credentialRef, { ...context, purpose: "api_key" }, async () => "no"))
      .rejects.toBeInstanceOf(CredentialDecryptionError);
  });

  it("rejects tampered ciphertext", async () => {
    const records = new MemoryRecords();
    const vault = new EncryptedCredentialVault(records, new TestKeyManagement());
    const stored = await vault.store(context, Buffer.from("synthetic-secret"));
    const ciphertext = records.records.get(stored.credentialRef)!.envelope.ciphertext;
    ciphertext[0] = ciphertext[0]! ^ 1;
    await expect(vault.withDecryptedCredential(stored.credentialRef, context, async () => "no"))
      .rejects.toBeInstanceOf(CredentialDecryptionError);
  });

  it("rejects use after revocation", async () => {
    const vault = new EncryptedCredentialVault(new MemoryRecords(), new TestKeyManagement());
    const stored = await vault.store(context, Buffer.from("synthetic-secret"));
    await vault.revoke(stored.credentialRef, context);
    await expect(vault.withDecryptedCredential(stored.credentialRef, context, async () => "no"))
      .rejects.toBeInstanceOf(CredentialDecryptionError);
  });
});


describe("webhook signing secret envelope", () => {
  it("binds ciphertext to tenant, endpoint, secret version and webhook-only purpose", async () => {
    const kms = new TestKeyManagement();
    const webhookContext: CredentialContext = {
      tenantId: "ten_webhook",
      accountId: "wh_endpoint_1",
      credentialId: "wh_endpoint_1",
      recordVersion: 3,
      purpose: "webhook_signing_secret"
    };
    const secret = Buffer.from("synthetic-webhook-signing-secret");
    const envelope = await encryptCredential(secret, webhookContext, kms);
    expect(Buffer.from(envelope.ciphertext).includes(secret)).toBe(false);

    const decrypted = await decryptCredential(envelope, webhookContext, kms);
    expect(decrypted.toString("utf8")).toBe(secret.toString("utf8"));
    decrypted.fill(0);

    await expect(decryptCredential(envelope, {
      ...webhookContext, accountId: "wh_other_endpoint"
    }, kms)).rejects.toBeInstanceOf(CredentialDecryptionError);
    await expect(decryptCredential(envelope, {
      ...webhookContext, tenantId: "ten_other"
    }, kms)).rejects.toBeInstanceOf(CredentialDecryptionError);
    await expect(decryptCredential(envelope, {
      ...webhookContext, recordVersion: 4
    }, kms)).rejects.toBeInstanceOf(CredentialDecryptionError);
    await expect(decryptCredential(envelope, {
      ...webhookContext, purpose: "api_key"
    }, kms)).rejects.toBeInstanceOf(CredentialDecryptionError);
  });
});
