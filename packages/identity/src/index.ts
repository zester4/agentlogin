import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type AgentCredentialRecord = {
  credentialId: string; tenantId: string; developerId: string; agentId: string;
  tokenHash: Uint8Array; createdAt: Date; expiresAt: Date; revokedAt: Date | null;
  tenantStatus: "active" | "suspended" | "closed";
  developerStatus: "active" | "suspended" | "closed";
  agentStatus: "active" | "suspended" | "revoked";
};
export type NewAgentCredential = Pick<AgentCredentialRecord,
  "credentialId" | "tenantId" | "developerId" | "agentId" | "tokenHash" | "createdAt" | "expiresAt">;
export interface AgentCredentialRepository {
  insert(record: NewAgentCredential): Promise<void>;
  findById(credentialId: string): Promise<AgentCredentialRecord | null>;
  revoke(credentialId: string, tenantId: string, revokedAt: Date): Promise<void>;
}
export type AgentPrincipal = { tenantId: string; developerId: string; agentId: string; credentialId: string };
export type IssuedAgentCredential = { credentialId: string; token: string; expiresAt: string };

export class AgentAuthenticationError extends Error {
  constructor() { super("Agent authentication failed."); this.name = "AgentAuthenticationError"; }
}

const TOKEN_PREFIX = "al_agent";
const TOKEN_PATTERN = /^al_agent_([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;
function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export class AgentCredentialService {
  constructor(private readonly repository: AgentCredentialRepository, private readonly now: () => Date = () => new Date()) {}

  async issue(input: { tenantId: string; developerId: string; agentId: string; expiresAt: Date }): Promise<IssuedAgentCredential> {
    const now = this.now();
    const ttl = input.expiresAt.getTime() - now.getTime();
    if (!input.tenantId || !input.developerId || !input.agentId ||
        !Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) {
      throw new TypeError("Invalid agent credential issuance request.");
    }
    const credentialId = randomBytes(16).toString("base64url");
    const secret = randomBytes(32).toString("base64url");
    const token = TOKEN_PREFIX + "_" + credentialId + "." + secret;
    await this.repository.insert({
      credentialId, tenantId: input.tenantId, developerId: input.developerId,
      agentId: input.agentId, tokenHash: hashSecret(secret), createdAt: now, expiresAt: input.expiresAt
    });
    return { credentialId, token, expiresAt: input.expiresAt.toISOString() };
  }

  async authenticate(token: string): Promise<AgentPrincipal> {
    const match = TOKEN_PATTERN.exec(token);
    if (!match) throw new AgentAuthenticationError();
    const credentialId = match[1];
    const secret = match[2];
    if (!credentialId || !secret) throw new AgentAuthenticationError();

    const record = await this.repository.findById(credentialId);
    if (!record || record.revokedAt !== null || record.expiresAt.getTime() <= this.now().getTime() ||
        record.tenantStatus !== "active" || record.developerStatus !== "active" || record.agentStatus !== "active") {
      throw new AgentAuthenticationError();
    }

    const suppliedHash = hashSecret(secret);
    const storedHash = Buffer.from(record.tokenHash);
    if (storedHash.byteLength !== suppliedHash.byteLength || !timingSafeEqual(storedHash, suppliedHash)) {
      throw new AgentAuthenticationError();
    }
    return {
      tenantId: record.tenantId, developerId: record.developerId,
      agentId: record.agentId, credentialId: record.credentialId
    };
  }

  async revoke(credentialId: string, tenantId: string): Promise<void> {
    if (!credentialId || !tenantId) throw new TypeError("Credential and tenant references are required.");
    await this.repository.revoke(credentialId, tenantId, this.now());
  }
}
