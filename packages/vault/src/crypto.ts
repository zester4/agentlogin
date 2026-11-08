import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CiphertextEnvelope, CredentialContext, CredentialRecordStore, CredentialVault, KeyManagementProvider, StoredCredential } from "./index.js";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD_VERSION = 1 as const;

export class CredentialDecryptionError extends Error {
  constructor() { super("Credential could not be decrypted."); this.name = "CredentialDecryptionError"; }
}

function assertContext(context: CredentialContext): void {
  if (!context.tenantId || !context.accountId || !context.credentialId ||
      !Number.isSafeInteger(context.recordVersion) || context.recordVersion < 1 ||
      !["website_login", "oauth_token", "api_key", "webhook_signing_secret"].includes(context.purpose)) {
    throw new TypeError("Invalid credential encryption context.");
  }
}

function associatedData(context: CredentialContext): Buffer {
  assertContext(context);
  const namespace = context.purpose === "webhook_signing_secret"
    ? "agentlogin-webhook-signing-secret" : "agentlogin-credential";
  return Buffer.from(JSON.stringify([
    namespace, AAD_VERSION, context.tenantId,
    context.accountId, context.credentialId, context.recordVersion, context.purpose
  ]), "utf8");
}

function assertEnvelope(envelope: CiphertextEnvelope): void {
  if (envelope.algorithm !== "AES-256-GCM" || envelope.aadVersion !== AAD_VERSION ||
      envelope.iv.byteLength !== IV_BYTES || envelope.authTag.byteLength !== TAG_BYTES ||
      envelope.wrappedDek.byteLength === 0 || !envelope.keyVersion || envelope.ciphertext.byteLength === 0) {
    throw new CredentialDecryptionError();
  }
}

export async function encryptCredential(
  plaintext: Uint8Array, context: CredentialContext, keyManagement: KeyManagementProvider
): Promise<CiphertextEnvelope> {
  if (plaintext.byteLength === 0) throw new TypeError("Credential plaintext must not be empty.");
  const dek = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const input = Buffer.from(plaintext);
  try {
    const cipher = createCipheriv("aes-256-gcm", dek, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(associatedData(context));
    const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
    const wrapped = await keyManagement.wrapKey(new Uint8Array(dek), context);
    if (!wrapped.wrappedDek.byteLength || !wrapped.keyVersion) {
      throw new Error("Key management provider returned an invalid wrapped key.");
    }
    return {
      algorithm: "AES-256-GCM", ciphertext: new Uint8Array(ciphertext),
      iv: new Uint8Array(iv), authTag: new Uint8Array(cipher.getAuthTag()),
      wrappedDek: new Uint8Array(wrapped.wrappedDek), keyVersion: wrapped.keyVersion,
      aadVersion: AAD_VERSION
    };
  } finally {
    dek.fill(0);
    input.fill(0);
  }
}

export async function decryptCredential(
  envelope: CiphertextEnvelope, context: CredentialContext, keyManagement: KeyManagementProvider
): Promise<Buffer> {
  let dek: Uint8Array | undefined;
  let keyBuffer: Buffer | undefined;
  try {
    assertEnvelope(envelope);
    dek = await keyManagement.unwrapKey(envelope.wrappedDek, envelope.keyVersion, context);
    if (dek.byteLength !== KEY_BYTES) throw new Error("Invalid data-encryption key length.");
    keyBuffer = Buffer.from(dek);
    const decipher = createDecipheriv("aes-256-gcm", keyBuffer, Buffer.from(envelope.iv), {
      authTagLength: TAG_BYTES
    });
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(Buffer.from(envelope.authTag));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext)), decipher.final()]);
  } catch {
    throw new CredentialDecryptionError();
  } finally {
    dek?.fill(0);
    keyBuffer?.fill(0);
  }
}

function sameContext(a: CredentialContext, b: CredentialContext): boolean {
  return a.tenantId === b.tenantId && a.credentialId === b.credentialId &&
    a.recordVersion === b.recordVersion && a.purpose === b.purpose;
}

export class EncryptedCredentialVault implements CredentialVault {
  constructor(
    private readonly records: CredentialRecordStore,
    private readonly keyManagement: KeyManagementProvider,
    private readonly createReference: () => string = () => "cred_" + randomBytes(18).toString("base64url"),
    private readonly now: () => Date = () => new Date()
  ) {}

  async store(context: CredentialContext, plaintext: Uint8Array): Promise<{ credentialRef: string; version: number }> {
    assertContext(context);
    const envelope = await encryptCredential(plaintext, context, this.keyManagement);
    const credentialRef = this.createReference();
    const record: StoredCredential = {
      credentialRef, context: { ...context }, envelope, revokedAt: null
    };
    await this.records.insert(record);
    return { credentialRef, version: context.recordVersion };
  }

  async rotate(
    previousCredentialRef: string,
    previousContext: CredentialContext,
    nextContext: CredentialContext,
    plaintext: Uint8Array
  ): Promise<{ credentialRef: string; version: number }> {
    assertContext(previousContext);
    assertContext(nextContext);
    if (previousContext.tenantId !== nextContext.tenantId ||
        previousContext.accountId !== nextContext.accountId ||
        previousContext.purpose !== nextContext.purpose ||
        nextContext.credentialId === previousContext.credentialId ||
        nextContext.recordVersion !== previousContext.recordVersion + 1) {
      throw new TypeError("Credential rotation must preserve account context and increment the version.");
    }
    const previous = await this.records.find(
      previousCredentialRef, previousContext.tenantId, previousContext.credentialId
    );
    if (!previous || previous.revokedAt !== null || !sameContext(previous.context, previousContext)) {
      throw new CredentialDecryptionError();
    }
    const envelope = await encryptCredential(plaintext, nextContext, this.keyManagement);
    const credentialRef = this.createReference();
    const record: StoredCredential = {
      credentialRef, context: { ...nextContext }, envelope, revokedAt: null
    };
    await this.records.rotate(previousCredentialRef, previousContext, record, this.now());
    return { credentialRef, version: nextContext.recordVersion };
  }

  async withDecryptedCredential<T>(
    credentialRef: string, context: CredentialContext, operation: (secret: Uint8Array) => Promise<T>
  ): Promise<T> {
    assertContext(context);
    const record = await this.records.find(credentialRef, context.tenantId, context.credentialId);
    if (!record || record.revokedAt !== null || !sameContext(record.context, context)) {
      throw new CredentialDecryptionError();
    }
    const plaintext = await decryptCredential(record.envelope, context, this.keyManagement);
    try {
      return await operation(plaintext);
    } finally {
      plaintext.fill(0);
    }
  }

  async revoke(credentialRef: string, context: CredentialContext): Promise<void> {
    assertContext(context);
    await this.records.revoke(credentialRef, context.tenantId, context.credentialId, this.now());
  }
}
