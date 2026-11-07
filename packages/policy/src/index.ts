export type AuthorizationContext = {
  tenantId: string;
  userId: string;
  authenticatedAgentId: string;
  expectedPolicyVersion: number;
  grant: {
    tenantId: string;
    userId: string;
    agentId: string;
    accountId: string;
    origin: string;
    scopes: string[];
    policyVersion: number;
    expiresAt: Date;
    revokedAt: Date | null;
    approvedAt: Date | null;
  };
  requestedAccountId: string;
  requestedOrigin: string;
  requestedScope: string;
  now: Date;
};

export type AuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "tenant_mismatch"
        | "user_mismatch"
        | "agent_mismatch"
        | "account_mismatch"
        | "origin_mismatch"
        | "scope_denied"
        | "policy_version_mismatch"
        | "expired"
        | "revoked"
        | "not_approved";
    };

function canonicalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]");
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function authorizeGrant(c: AuthorizationContext): AuthorizationDecision {
  const g = c.grant;
  if (!c.tenantId || c.tenantId !== g.tenantId) {
    return { allowed: false, reason: "tenant_mismatch" };
  }
  if (!c.userId || c.userId !== g.userId) {
    return { allowed: false, reason: "user_mismatch" };
  }
  if (!c.authenticatedAgentId || c.authenticatedAgentId !== g.agentId) {
    return { allowed: false, reason: "agent_mismatch" };
  }
  if (c.requestedAccountId !== g.accountId) {
    return { allowed: false, reason: "account_mismatch" };
  }
  const requestedOrigin = canonicalOrigin(c.requestedOrigin);
  const grantOrigin = canonicalOrigin(g.origin);
  if (!requestedOrigin || !grantOrigin || requestedOrigin !== grantOrigin) {
    return { allowed: false, reason: "origin_mismatch" };
  }
  if (!g.scopes.includes(c.requestedScope)) {
    return { allowed: false, reason: "scope_denied" };
  }
  if (
    !Number.isSafeInteger(c.expectedPolicyVersion) ||
    c.expectedPolicyVersion < 1 ||
    g.policyVersion !== c.expectedPolicyVersion
  ) {
    return { allowed: false, reason: "policy_version_mismatch" };
  }
  if (
    !Number.isFinite(c.now.getTime()) ||
    !Number.isFinite(g.expiresAt.getTime()) ||
    g.expiresAt.getTime() <= c.now.getTime()
  ) {
    return { allowed: false, reason: "expired" };
  }
  if (g.revokedAt !== null) {
    return { allowed: false, reason: "revoked" };
  }
  if (
    g.approvedAt === null ||
    !Number.isFinite(g.approvedAt.getTime()) ||
    g.approvedAt.getTime() > c.now.getTime()
  ) {
    return { allowed: false, reason: "not_approved" };
  }
  return { allowed: true };
}
