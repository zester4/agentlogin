import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import type { CredentialContext, KeyManagementProvider, WrappedDataKey } from "./index.js";

function encryptionContext(context: CredentialContext): Record<string, string> {
  if (!context.tenantId || !context.credentialId || !Number.isSafeInteger(context.recordVersion) || context.recordVersion < 1) {
    throw new TypeError("Invalid credential encryption context.");
  }
  return {
    tenant_id: context.tenantId,
    credential_id: context.credentialId,
    record_version: String(context.recordVersion),
    purpose: context.purpose
  };
}

/**
 * AWS KMS envelope-key adapter. The application generates a random 256-bit
 * DEK and asks KMS to wrap it; only the wrapped DEK is persisted. The
 * encryption context cryptographically binds the wrapped key to the
 * tenant/credential/version/purpose tuple.
 *
 * Run the API with a narrowly scoped workload IAM role where available.
 * Grant only kms:Encrypt and kms:Decrypt on the dedicated key. Do not give
 * the API general key-administration permissions.
 */
export class AwsKmsProvider implements KeyManagementProvider {
  private readonly client: KMSClient;
  constructor(
    private readonly keyId: string,
    region: string,
    client?: KMSClient
  ) {
    if (!keyId.trim() || !region.trim()) throw new TypeError("AWS KMS key ID and region are required.");
    this.client = client ?? new KMSClient({ region });
  }

  async wrapKey(dek: Uint8Array, context: CredentialContext): Promise<WrappedDataKey> {
    if (dek.byteLength !== 32) throw new TypeError("Credential DEK must be exactly 256 bits.");
    const result = await this.client.send(new EncryptCommand({
      KeyId: this.keyId,
      Plaintext: dek,
      EncryptionContext: encryptionContext(context)
    }));
    if (!result.CiphertextBlob || result.CiphertextBlob.byteLength === 0 || !result.KeyId) {
      throw new Error("KMS did not return a wrapped data key.");
    }
    return { wrappedDek: new Uint8Array(result.CiphertextBlob), keyVersion: result.KeyId };
  }

  async unwrapKey(wrappedDek: Uint8Array, keyVersion: string, context: CredentialContext): Promise<Uint8Array> {
    if (!wrappedDek.byteLength || !keyVersion.trim()) throw new TypeError("Wrapped DEK and key version are required.");
    const result = await this.client.send(new DecryptCommand({
      KeyId: keyVersion,
      CiphertextBlob: wrappedDek,
      EncryptionContext: encryptionContext(context)
    }));
    if (!result.Plaintext || result.Plaintext.byteLength !== 32) {
      result.Plaintext?.fill(0);
      throw new Error("KMS returned an invalid credential data key.");
    }
    return new Uint8Array(result.Plaintext);
  }
}
