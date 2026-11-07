export type AuthorizationContext = {
  tenantId: string; userId: string; authenticatedAgentId: string;
  grant: { tenantId: string; userId: string; agentId: string; accountId: string; origin: string;
    scopes: string[]; expiresAt: Date; revokedAt: Date | null; approvedAt: Date | null };
  requestedAccountId: string; requestedOrigin: string; requestedScope: string; now: Date;
};
export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: "tenant_mismatch" | "user_mismatch" | "agent_mismatch" | "account_mismatch" | "origin_mismatch" | "scope_denied" | "expired" | "revoked" | "not_approved" };
export function authorizeGrant(c: AuthorizationContext): AuthorizationDecision {
  const g = c.grant;
  if (!c.tenantId || c.tenantId !== g.tenantId) return { allowed: false, reason: "tenant_mismatch" };
  if (c.userId !== g.userId) return { allowed: false, reason: "user_mismatch" };
  if (c.authenticatedAgentId !== g.agentId) return { allowed: false, reason: "agent_mismatch" };
  if (c.requestedAccountId !== g.accountId) return { allowed: false, reason: "account_mismatch" };
  if (c.requestedOrigin !== g.origin) return { allowed: false, reason: "origin_mismatch" };
  if (!g.scopes.includes(c.requestedScope)) return { allowed: false, reason: "scope_denied" };
  if (g.expiresAt.getTime() <= c.now.getTime()) return { allowed: false, reason: "expired" };
  if (g.revokedAt !== null) return { allowed: false, reason: "revoked" };
  if (g.approvedAt === null) return { allowed: false, reason: "not_approved" };
  return { allowed: true };
}
