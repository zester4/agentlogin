import { randomBytes } from "node:crypto";
import { GrantRequestSchema, OriginSchema, type GrantScope } from "@agentlogin/contracts";
import { authorizeGrant, type AuthorizationDecision } from "./index.js";

export type GrantLifecycleRecord = {
  id: string; tenantId: string; userId: string; agentId: string; accountId: string;
  origin: string; scopes: string[]; taskId: string | null; policyVersion: number;
  issuedAt: Date; expiresAt: Date; revokedAt: Date | null; approvalId: string | null;
  approvedAt: Date | null; approvalDecision: string | null;
};
export interface GrantLifecycleRepository {
  hasActiveDelegation(input: { userId: string; agentId: string; accountId: string; scopes: string[] }): Promise<boolean>;
  createPending(input: {
    id: string; tenantId: string; userId: string; agentId: string; accountId: string;
    origin: string; scopes: string[]; taskId: string | null; policyVersion: number;
    issuedAt: Date; expiresAt: Date; requestedBy: string; createdAt: Date;
  }): Promise<{ grantId: string; approvalId: string }>;
  find(grantId: string): Promise<GrantLifecycleRecord | null>;
  decide(input: { approvalId: string; userId: string; decision: "approved" | "denied"; decidedAt: Date }): Promise<boolean>;
  revoke(grantId: string, revokedAt: Date, revokedBy: string): Promise<boolean>;
}
export type GrantRequestPrincipal = { tenantId: string; userId: string; agentId: string };

export class GrantLifecycleError extends Error {
  constructor(readonly code: "delegation_required" | "grant_not_found" | "approval_not_found" | "not_owner" | "invalid_grant", message: string) {
    super(message); this.name = "GrantLifecycleError";
  }
}

/**
 * Conservative first-release lifecycle: an active user delegation is required
 * before a request can be queued, and every grant still requires an explicit
 * approval decision. The requester's identity is supplied by trusted API
 * authentication, never copied from the request body.
 */
export class GrantLifecycleService {
  constructor(
    private readonly repository: GrantLifecycleRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => randomBytes(24).toString("base64url")
  ) {}

  async request(principal: GrantRequestPrincipal, raw: unknown) {
    const parsed = GrantRequestSchema.safeParse(raw);
    if (!parsed.success) throw new GrantLifecycleError("invalid_grant", "The grant request is invalid.");
    const request = parsed.data;
    const origin = OriginSchema.safeParse(request.origin);
    if (!origin.success) throw new GrantLifecycleError("invalid_grant", "A normalized HTTPS origin is required.");
    const parsedOrigin = new URL(origin.data);
    const localDevelopmentOrigin = parsedOrigin.protocol === "http:" &&
      (parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1" || parsedOrigin.hostname === "[::1]");
    if (parsedOrigin.protocol !== "https:" && !localDevelopmentOrigin) {
      throw new GrantLifecycleError("invalid_grant", "A normalized HTTPS origin is required.");
    }
    if (!principal.tenantId || !principal.userId || !principal.agentId) {
      throw new GrantLifecycleError("invalid_grant", "An authenticated user and agent context is required.");
    }
    const delegated = await this.repository.hasActiveDelegation({
      userId: principal.userId, agentId: principal.agentId,
      accountId: request.account_id, scopes: request.scopes
    });
    if (!delegated) throw new GrantLifecycleError("delegation_required", "The user has not delegated this account and scope to this agent.");

    const issuedAt = this.now();
    const grantId = "grt_" + this.newId();
    const expiresAt = new Date(issuedAt.getTime() + request.requested_ttl_seconds * 1000);
    const result = await this.repository.createPending({
      id: grantId, tenantId: principal.tenantId, userId: principal.userId,
      agentId: principal.agentId, accountId: request.account_id, origin: origin.data,
      scopes: request.scopes as GrantScope[], taskId: request.task_id ?? null,
      policyVersion: 1, issuedAt, expiresAt, requestedBy: principal.agentId, createdAt: issuedAt
    });
    return { status: "pending_approval" as const, grant_id: result.grantId, approval_id: result.approvalId, expires_at: expiresAt.toISOString() };
  }

  async decide(input: { principal: { tenantId: string; userId: string }; grantId: string; approvalId: string; decision: "approved" | "denied" }): Promise<boolean> {
    const grant = await this.repository.find(input.grantId);
    if (!grant || grant.tenantId !== input.principal.tenantId) throw new GrantLifecycleError("grant_not_found", "The grant was not found.");
    if (grant.userId !== input.principal.userId) throw new GrantLifecycleError("not_owner", "Only the account owner may decide this approval.");
    if (grant.revokedAt || grant.expiresAt.getTime() <= this.now().getTime()) {
      throw new GrantLifecycleError("approval_not_found", "The grant is no longer eligible for approval.");
    }
    if (!grant.approvalId || grant.approvalId !== input.approvalId) {
      throw new GrantLifecycleError("approval_not_found", "The approval was not found.");
    }
    if (grant.approvalDecision !== "pending") return false;
    return this.repository.decide({ approvalId: input.approvalId, userId: input.principal.userId, decision: input.decision, decidedAt: this.now() });
  }

  async authorize(input: {
    principal: { tenantId: string; userId: string; agentId: string };
    grantId: string; accountId: string; origin: string; scope: GrantScope;
    expectedPolicyVersion: number;
  }): Promise<AuthorizationDecision> {
    const grant = await this.repository.find(input.grantId);
    if (!grant) return { allowed: false, reason: "scope_denied" };
    return authorizeGrant({
      tenantId: input.principal.tenantId, userId: input.principal.userId,
      authenticatedAgentId: input.principal.agentId, expectedPolicyVersion: input.expectedPolicyVersion,
      requestedAccountId: input.accountId, requestedOrigin: input.origin, requestedScope: input.scope,
      now: this.now(),
      grant: {
        tenantId: grant.tenantId, userId: grant.userId, agentId: grant.agentId,
        accountId: grant.accountId, origin: grant.origin, scopes: grant.scopes,
        policyVersion: grant.policyVersion, expiresAt: grant.expiresAt,
        revokedAt: grant.revokedAt,
        approvedAt: grant.approvalDecision === "approved" ? grant.approvedAt : null
      }
    });
  }

  async revoke(principal: { tenantId: string; userId: string }, grantId: string): Promise<boolean> {
    const grant = await this.repository.find(grantId);
    if (!grant || grant.tenantId !== principal.tenantId) throw new GrantLifecycleError("grant_not_found", "The grant was not found.");
    if (grant.userId !== principal.userId) throw new GrantLifecycleError("not_owner", "Only the account owner may revoke this grant.");
    return this.repository.revoke(grantId, this.now(), input.userId);
  }
}
