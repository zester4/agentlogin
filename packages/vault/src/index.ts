export type CiphertextEnvelope = {
  algorithm: "AES-256-GCM"; ciphertext: Uint8Array; iv: Uint8Array;
  authTag: Uint8Array; wrappedDek: Uint8Array; keyVersion: string; aadVersion: 1;
};
export type CredentialContext = {
  tenantId: string; accountId: string; credentialId: string; recordVersion: number;
  purpose: "website_login" | "oauth_token" | "api_key" | "webhook_signing_secret";
};
export type WrappedDataKey = { wrappedDek: Uint8Array; keyVersion: string };
export interface KeyManagementProvider {
  wrapKey(dek: Uint8Array, context: CredentialContext): Promise<WrappedDataKey>;
  unwrapKey(wrappedDek: Uint8Array, keyVersion: string, context: CredentialContext): Promise<Uint8Array>;
}
export type StoredCredential = {
  credentialRef: string; context: CredentialContext; envelope: CiphertextEnvelope; revokedAt: Date | null;
};
export interface CredentialRecordStore {
  insert(record: StoredCredential): Promise<void>;
  rotate(previousCredentialRef: string, previousContext: CredentialContext, record: StoredCredential, revokedAt: Date): Promise<void>;
  find(credentialRef: string, tenantId: string, credentialId: string): Promise<StoredCredential | null>;
  revoke(credentialRef: string, tenantId: string, credentialId: string, revokedAt: Date): Promise<void>;
}
export interface CredentialVault {
  store(context: CredentialContext, plaintext: Uint8Array): Promise<{ credentialRef: string; version: number }>;
  rotate(previousCredentialRef: string, previousContext: CredentialContext, nextContext: CredentialContext, plaintext: Uint8Array): Promise<{ credentialRef: string; version: number }>;
  withDecryptedCredential<T>(credentialRef: string, context: CredentialContext, operation: (secret: Uint8Array) => Promise<T>): Promise<T>;
  revoke(credentialRef: string, context: CredentialContext): Promise<void>;
}
export * from "./aws-kms.js";
export * from "./crypto.js";
