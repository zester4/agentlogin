import {
  parseAgentCredential,
  parseDeveloperCredential,
  verifySecret
} from "./credentials.js";
import type { IdentityStore, AgentPrincipal, DeveloperPrincipal } from "./types.js";
import type { UserTokenVerifier } from "./user-jwt.js";

export class IdentityService {
  constructor(private readonly store: IdentityStore, private readonly userVerifier: UserTokenVerifier | null) {}

  async authenticateDeveloper(token: string): Promise<DeveloperPrincipal | null> {
    const parsed = parseDeveloperCredential(token);
    if (!parsed) return null;
    // The tenant/developer IDs in the token are only lookup selectors. The principal below
    // is constructed from the database row only after the one-way secret hash is verified.
    const row = await this.store.findDeveloperCredential({
      tenantId: parsed.tenantId,
      developerId: parsed.developerId,
      credentialId: parsed.credentialId
    });
    if (
      !row ||
      !verifySecret(parsed.secret, row.secretHash) ||
      row.tenantId !== parsed.tenantId ||
      row.developerId !== parsed.developerId ||
      row.developerStatus !== "active" ||
      row.tenantStatus !== "active" ||
      row.revokedAt !== null ||
      row.expiresAt.getTime() <= Date.now()
    ) return null;

    const stillActive = await this.store.touchDeveloperCredential({
      tenantId: row.tenantId,
      developerId: row.developerId,
      credentialId: row.id
    });
    if (!stillActive) return null;
    return {
      kind: "developer",
      tenantId: row.tenantId,
      developerId: row.developerId,
      credentialId: row.id,
      scopes: row.scopes
    };
  }

  async authenticateAgent(token: string): Promise<AgentPrincipal | null> {
    const parsed = parseAgentCredential(token);
    if (!parsed) return null;
    // As above, token identifiers only narrow the RLS-protected lookup. The database row
    // and secret-hash match establish the authenticated tenant and agent.
    const row = await this.store.findAgentCredential({
      tenantId: parsed.tenantId,
      developerId: parsed.developerId,
      agentId: parsed.agentId,
      credentialId: parsed.credentialId
    });
    if (
      !row ||
      !verifySecret(parsed.secret, row.secretHash) ||
      row.tenantId !== parsed.tenantId ||
      row.developerId !== parsed.developerId ||
      row.agentId !== parsed.agentId ||
      row.agentStatus !== "active" ||
      row.developerStatus !== "active" ||
      row.tenantStatus !== "active" ||
      row.revokedAt !== null ||
      row.expiresAt.getTime() <= Date.now()
    ) return null;

    const stillActive = await this.store.touchAgentCredential({
      tenantId: row.tenantId,
      developerId: row.developerId,
      agentId: row.agentId,
      credentialId: row.id
    });
    if (!stillActive) return null;
    return {
      kind: "agent",
      tenantId: row.tenantId,
      developerId: row.developerId,
      agentId: row.agentId,
      credentialId: row.id,
      scopes: row.scopes
    };
  }

  async authenticateUser(token: string) {
    if (!this.userVerifier) return null;
    const claims = this.userVerifier.verify(token);
    const user = await this.store.findUser({
      tenantId: claims.tenantId,
      issuer: claims.issuer,
      subject: claims.subject
    });
    if (!user || user.status !== "active" || user.tenantId !== claims.tenantId) return null;
    return {
      kind: "user" as const,
      tenantId: user.tenantId,
      userId: user.id,
      role: user.role,
      issuer: claims.issuer,
      subject: claims.subject
    };
  }
}
