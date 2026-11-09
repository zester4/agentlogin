import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type AgentCredentialRecord = {
  credentialId: string; tenantId: string; developerId: string; agentId: string;
  tokenHash: Uint8Array; createdAt: Date; expiresAt: Date; revokedAt: Date | null;
  tenantStatus: string;
  developerStatus: string;
  agentStatus: "active" | "suspended" | "revoked";
};
export type NewAgentCredential = Pick<AgentCredentialRecord,
  "credentialId" | "tenantId" | "developerId" | "agentId" | "tokenHash" | "createdAt" | "expiresAt">;
export interface AgentCredentialRepository {
  insert(record: NewAgentCredential): Promise<void>;
  rotate?(record: NewAgentCredential): Promise<void>;
  findById(credentialId: string): Promise<AgentCredentialRecord | null>;
  revoke(credentialId: string, tenantId: string, revokedAt: Date): Promise<void>;
}
export type AgentPrincipal = { tenantId: string; developerId: string; agentId: string; credentialId: string };
export type IssuedAgentCredential = { credentialId: string; token: string; expiresAt: string };

export class AgentAuthenticationError extends Error {
  constructor() { super("Agent authentication failed."); this.name = "AgentAuthenticationError"; }
}

const TOKEN_PREFIX = "al_agent";
const TOKEN_PATTERN = /^al_agent_([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{1,300})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;
const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;
function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}
function decodeCanonicalBase64Url(value: string): Buffer | null {
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : null;
  } catch { return null; }
}
function encodeTenant(tenantId: string): string {
  return Buffer.from(tenantId, "utf8").toString("base64url");
}
function decodeTenant(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (!decoded || encodeTenant(decoded) !== value || decoded.trim() !== decoded || decoded.length > 200) return null;
    return decoded;
  } catch { return null; }
}
function signature(key: Uint8Array, credentialId: string, tenantClaim: string): Buffer {
  return createHmac("sha256", key).update(`${credentialId}.${tenantClaim}`, "utf8").digest();
}

/**
 * Signing key is a server secret (>=256 bits), not an agent token. The signed
 * tenant claim is only trusted after HMAC verification and is then used to
 * construct a tenant-bound RLS repository. Never use an unverified claim for
 * a database query. Keep the key stable across deploys; rotate with an explicit
 * key-id/key-ring migration rather than replacing it in place.
 */
export type AgentCredentialRepositoryResolver = (verifiedTenantId: string) => AgentCredentialRepository;

export class AgentCredentialService {
  private readonly signingKey: Buffer;
  constructor(
    private readonly repository: AgentCredentialRepository | AgentCredentialRepositoryResolver,
    signingKey: Uint8Array,
    private readonly now: () => Date = () => new Date()
  ) {
    if (signingKey.byteLength < 32) throw new TypeError("Agent token signing key must contain at least 32 bytes.");
    this.signingKey = Buffer.from(signingKey);
  }

  async issue(input: { tenantId: string; developerId: string; agentId: string; expiresAt: Date }): Promise<IssuedAgentCredential> {
    return this.issueCredential(input, false);
  }

  async rotate(input: { tenantId: string; developerId: string; agentId: string; expiresAt: Date }): Promise<IssuedAgentCredential> {
    return this.issueCredential(input, true);
  }

  private async issueCredential(input: { tenantId: string; developerId: string; agentId: string; expiresAt: Date }, rotate: boolean): Promise<IssuedAgentCredential> {
    const now = this.now();
    const ttl = input.expiresAt.getTime() - now.getTime();
    if (!input.tenantId || input.tenantId.trim() !== input.tenantId || input.tenantId.length > 200 ||
        !input.developerId || !input.agentId || !Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) {
      throw new TypeError("Invalid agent credential issuance request.");
    }
    const repository = this.repositoryFor(input.tenantId);
    const credentialId = randomBytes(16).toString("base64url");
    const tenantClaim = encodeTenant(input.tenantId);
    const secret = randomBytes(32).toString("base64url");
    const sig = signature(this.signingKey, credentialId, tenantClaim).toString("base64url");
    const token = `${TOKEN_PREFIX}_${credentialId}.${tenantClaim}.${secret}.${sig}`;
    const record = {
      credentialId, tenantId: input.tenantId, developerId: input.developerId,
      agentId: input.agentId, tokenHash: hashSecret(secret), createdAt: now, expiresAt: input.expiresAt
    };
    if (rotate) {
      if (!repository.rotate) throw new Error("Atomic credential rotation is not supported by this repository.");
      await repository.rotate(record);
    } else {
      await repository.insert(record);
    }
    return { credentialId, token, expiresAt: input.expiresAt.toISOString() };
  }

  async authenticate(token: string): Promise<AgentPrincipal> {
    if (typeof token !== "string" || token.length > 1024) throw new AgentAuthenticationError();
    const match = TOKEN_PATTERN.exec(token);
    if (!match) throw new AgentAuthenticationError();
    const [, credentialId, tenantClaim, secret, suppliedSignature] = match;
    if (!credentialId || !tenantClaim || !secret || !suppliedSignature) throw new AgentAuthenticationError();
    const credentialIdBytes = decodeCanonicalBase64Url(credentialId);
    const secretBytes = decodeCanonicalBase64Url(secret);
    const signatureBytes = decodeCanonicalBase64Url(suppliedSignature);
    if (credentialIdBytes?.byteLength !== 16 || secretBytes?.byteLength !== 32 ||
        signatureBytes?.byteLength !== 32) throw new AgentAuthenticationError();

    // Verify the tenant claim before any database access. This prevents an
    // attacker-controlled tenant prefix from selecting another RLS context.
    const tenantId = decodeTenant(tenantClaim);
    if (!tenantId) throw new AgentAuthenticationError();
    const expectedSignature = signature(this.signingKey, credentialId, tenantClaim);
    const receivedSignature = signatureBytes;
    if (receivedSignature.byteLength !== expectedSignature.byteLength ||
        !timingSafeEqual(receivedSignature, expectedSignature)) throw new AgentAuthenticationError();

    // The injected repository must be bound to this verified tenant. A
    // per-request repository factory should construct it only after this
    // signature check; this single-tenant service enforces that binding.
    const record = await this.repositoryFor(tenantId).findById(credentialId);
    if (!record || record.tenantId !== tenantId || record.revokedAt !== null ||
        record.expiresAt.getTime() <= this.now().getTime() ||
        record.tenantStatus !== "active" || record.developerStatus !== "active" || record.agentStatus !== "active") {
      throw new AgentAuthenticationError();
    }
    const suppliedHash = hashSecret(secret);
    const storedHash = Buffer.from(record.tokenHash);
    if (storedHash.byteLength !== suppliedHash.byteLength || !timingSafeEqual(storedHash, suppliedHash)) {
      throw new AgentAuthenticationError();
    }
    return { tenantId: record.tenantId, developerId: record.developerId, agentId: record.agentId, credentialId: record.credentialId };
  }

  async revoke(credentialId: string, tenantId: string): Promise<void> {
    if (!credentialId || !tenantId) throw new TypeError("Credential and tenant references are required.");
    await this.repositoryFor(tenantId).revoke(credentialId, tenantId, this.now());
  }

  private repositoryFor(verifiedTenantId: string): AgentCredentialRepository {
    // Resolver invocation happens only with a server-trusted tenant ID:
    // issuance input must already be authorized; authentication reaches here
    // only after signature verification.
    return typeof this.repository === "function"
      ? this.repository(verifiedTenantId)
      : this.repository;
  }
}


/** OAuth-style developer application credentials. Client secrets and access
 * tokens are stored as SHA-256 hashes; tenant claims are HMAC-authenticated
 * before they are used to select an RLS tenant context. */
export type DeveloperApplicationRecord = {
  applicationId: string; tenantId: string; developerId: string;
  clientSecretHash: Uint8Array;
  applicationStatus: string;
  developerStatus: string;
  tenantStatus: string;
};
export type ApplicationAccessTokenRecord = {
  tokenId: string; tenantId: string; applicationId: string; developerId: string;
  tokenHash: Uint8Array; scopes: string[]; expiresAt: Date; revokedAt: Date | null;
  applicationStatus: string;
  developerStatus: string;
  tenantStatus: string;
};
export interface ApplicationCredentialRepository {
  insertApplication(input: { applicationId: string; tenantId: string; userId: string; developerId: string; name: string; clientId: string; clientSecretHash: Uint8Array }): Promise<void>;
  findApplication(applicationId: string, tenantId: string): Promise<DeveloperApplicationRecord | null>;
  insertAccessToken(input: { tokenId: string; tenantId: string; applicationId: string; tokenHash: Uint8Array; scopes: string[]; expiresAt: Date }): Promise<void>;
  findAccessToken(tokenId: string, tenantId: string): Promise<ApplicationAccessTokenRecord | null>;
  updateAccessTokenLastUsed(tokenId: string, tenantId: string, at: Date): Promise<void>;
}
export type ApplicationPrincipal = { tenantId: string; developerId: string; applicationId: string; tokenId: string; scopes: string[] };
export type IssuedApplicationCredentials = { applicationId: string; clientId: string; clientSecret: string; displayOnce: true };
export type IssuedApplicationAccessToken = { access_token: string; token_type: "Bearer"; expires_in: number; scope: string };

function applicationHash(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }
function applicationEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
function applicationTenant(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
function applicationTenantDecode(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return decoded && applicationTenant(decoded) === value && decoded.trim() === decoded &&
      decoded.length <= 200 && !/[\u0000-\u001f\u007f]/.test(decoded) ? decoded : null;
  } catch { return null; }
}
function applicationSignature(key: Uint8Array, kind: "client" | "token", id: string, tenant: string): string {
  return createHmac("sha256", key).update(`${kind}.${id}.${tenant}`, "utf8").digest("base64url");
}
function applicationStatusActive(record: { applicationStatus: string; developerStatus: string; tenantStatus: string }): boolean {
  return record.applicationStatus === "active" && record.developerStatus === "active" && record.tenantStatus === "active";
}

export class ApplicationCredentialAuthenticationError extends Error {
  constructor() { super("Application authentication failed."); this.name = "ApplicationCredentialAuthenticationError"; }
}

export class ApplicationCredentialService {
  private readonly signingKey: Buffer;
  constructor(
    private readonly repository: ApplicationCredentialRepository | ((tenantId: string) => ApplicationCredentialRepository),
    signingKey: Uint8Array,
    private readonly now: () => Date = () => new Date(),
    private readonly accessTokenTtlSeconds = 900
  ) {
    if (signingKey.byteLength < 32) throw new TypeError("Application signing key must contain at least 32 bytes.");
    if (!Number.isSafeInteger(accessTokenTtlSeconds) || accessTokenTtlSeconds < 60 || accessTokenTtlSeconds > 3600) {
      throw new TypeError("Application access token TTL must be between 60 and 3600 seconds.");
    }
    this.signingKey = Buffer.from(signingKey);
  }

  async create(input: { tenantId: string; userId: string; developerId: string; name: string }): Promise<IssuedApplicationCredentials> {
    if (!input.tenantId || input.tenantId.trim() !== input.tenantId || input.tenantId.length > 200 ||
        !input.userId || !input.developerId || !input.name.trim() || input.name.trim().length > 120) {
      throw new TypeError("Invalid application creation request.");
    }
    const applicationId = randomBytes(18).toString("base64url");
    const tenant = applicationTenant(input.tenantId);
    const clientId = `al_client_${tenant}.${applicationId}.${applicationSignature(this.signingKey, "client", applicationId, tenant)}`;
    const clientSecret = `al_secret_${randomBytes(32).toString("base64url")}`;
    await this.repositoryFor(input.tenantId).insertApplication({
      applicationId, tenantId: input.tenantId, userId: input.userId, developerId: input.developerId,
      name: input.name.trim(), clientId, clientSecretHash: applicationHash(clientSecret)
    });
    return { applicationId, clientId, clientSecret, displayOnce: true };
  }

  async exchange(input: { clientId: string; clientSecret: string }): Promise<IssuedApplicationAccessToken> {
    const parsed = /^al_client_([A-Za-z0-9_-]{1,267})\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/.exec(input.clientId);
    if (!parsed || typeof input.clientSecret !== "string" || !input.clientSecret.startsWith("al_secret_")) {
      throw new ApplicationCredentialAuthenticationError();
    }
    const tenantId = applicationTenantDecode(parsed[1]!);
    if (!tenantId || !applicationEqual(Buffer.from(parsed[3]!, "base64url"),
      Buffer.from(applicationSignature(this.signingKey, "client", parsed[2]!, parsed[1]!), "base64url"))) {
      throw new ApplicationCredentialAuthenticationError();
    }
    const repository = this.repositoryFor(tenantId);
    const application = await repository.findApplication(parsed[2]!, tenantId);
    if (!application || !applicationStatusActive(application) ||
        !applicationEqual(application.clientSecretHash, applicationHash(input.clientSecret))) {
      throw new ApplicationCredentialAuthenticationError();
    }
    const tokenId = randomBytes(16).toString("base64url");
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + this.accessTokenTtlSeconds * 1000);
    const scopes = ["agents:manage", "grants:request"];
    await repository.insertAccessToken({
      tokenId, tenantId, applicationId: application.applicationId,
      tokenHash: applicationHash(secret), scopes, expiresAt
    });
    const tenant = applicationTenant(tenantId);
    const signature = applicationSignature(this.signingKey, "token", tokenId, tenant);
    return {
      access_token: `al_app_${tenant}.${tokenId}.${signature}.${secret}`,
      token_type: "Bearer", expires_in: this.accessTokenTtlSeconds, scope: scopes.join(" ")
    };
  }

  async authenticate(token: string): Promise<ApplicationPrincipal> {
    const parsed = /^al_app_([A-Za-z0-9_-]{1,267})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!parsed) throw new ApplicationCredentialAuthenticationError();
    const tenantId = applicationTenantDecode(parsed[1]!);
    if (!tenantId || !applicationEqual(Buffer.from(parsed[3]!, "base64url"),
      Buffer.from(applicationSignature(this.signingKey, "token", parsed[2]!, parsed[1]!), "base64url"))) {
      throw new ApplicationCredentialAuthenticationError();
    }
    const repository = this.repositoryFor(tenantId);
    const record = await repository.findAccessToken(parsed[2]!, tenantId);
    if (!record || record.revokedAt || record.expiresAt.getTime() <= this.now().getTime() ||
        !applicationStatusActive(record) || !applicationEqual(record.tokenHash, applicationHash(parsed[4]!))) {
      throw new ApplicationCredentialAuthenticationError();
    }
    await repository.updateAccessTokenLastUsed(record.tokenId, tenantId, this.now());
    return { tenantId, developerId: record.developerId,
      applicationId: record.applicationId, tokenId: record.tokenId, scopes: record.scopes };
  }

  private repositoryFor(tenantId: string): ApplicationCredentialRepository {
    return typeof this.repository === "function" ? this.repository(tenantId) : this.repository;
  }
}
