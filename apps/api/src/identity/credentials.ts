import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const DEVELOPER_SCOPES = ["developer:read", "agents:manage", "keys:manage"] as const;
export const AGENT_SCOPES = ["agent:read"] as const;
export const DEFAULT_CREDENTIAL_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAX_CREDENTIAL_TTL_SECONDS = 90 * 24 * 60 * 60;

export function newId(prefix: string): string {
  return prefix + "_" + randomUUID();
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function verifySecret(secret: string, expectedHash: Uint8Array): boolean {
  const actual = hashSecret(secret);
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueDeveloperCredential(tenantId: string, developerId: string, ttlSeconds = DEFAULT_CREDENTIAL_TTL_SECONDS) {
  const id = newId("dkey");
  const secret = newSecret();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  return {
    id,
    token: "ald_" + tenantId + "." + developerId + "." + id + "." + secret,
    secretHash: hashSecret(secret),
    scopes: [...DEVELOPER_SCOPES],
    expiresAt
  };
}

export function issueAgentCredential(tenantId: string, developerId: string, agentId: string, scopes: string[], ttlSeconds = DEFAULT_CREDENTIAL_TTL_SECONDS) {
  const id = newId("akey");
  const secret = newSecret();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  return {
    id,
    agentId,
    token: "ala_" + tenantId + "." + developerId + "." + agentId + "." + id + "." + secret,
    secretHash: hashSecret(secret),
    scopes,
    expiresAt
  };
}

export function parseDeveloperCredential(token: string) {
  const match = /^ald_(ten_[0-9a-f-]{36})\.(dev_[0-9a-f-]{36})\.(dkey_[0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  return { tenantId: match[1]!, developerId: match[2]!, credentialId: match[3]!, secret: match[4]! };
}

export function parseAgentCredential(token: string) {
  const match = /^ala_(ten_[0-9a-f-]{36})\.(dev_[0-9a-f-]{36})\.(agt_[0-9a-f-]{36})\.(akey_[0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  return { tenantId: match[1]!, developerId: match[2]!, agentId: match[3]!, credentialId: match[4]!, secret: match[5]! };
}
