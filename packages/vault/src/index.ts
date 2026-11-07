export type CiphertextEnvelope = {
  algorithm: "AES-256-GCM"; ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array;
  wrappedDek: Uint8Array; keyVersion: string; aadVersion: number;
};
export type CredentialContext = { tenantId: string; credentialId: string; recordVersion: number;
  purpose: "website_login" | "oauth_token" | "api_key" };
export interface KeyManagementProvider {
  wrapKey(dek: Uint8Array, context: CredentialContext): Promise<Uint8Array>;
  unwrapKey(wrappedDek: Uint8Array, context: CredentialContext): Promise<Uint8Array>;
}
export interface CredentialVault {
  store(context: CredentialContext, plaintext: Uint8Array): Promise<{credentialRef:string;version:number}>;
  withDecryptedCredential<T>(credentialRef:string, context:CredentialContext, operation:(secret:Uint8Array)=>Promise<T>):Promise<T>;
  revoke(credentialRef:string, context:CredentialContext):Promise<void>;
}
// No plaintext-returning API. Production implementation requires authenticated envelope encryption,
// KMS-backed key wrapping, tenant/purpose AAD binding, narrow worker identity and audit.
