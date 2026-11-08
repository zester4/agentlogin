import { OriginSchema } from "@agentlogin/contracts";

export type ApprovalSnapshot = {
  id: string;
  status: "approved" | "pending" | "denied";
};

export type AuthorizationContext = {
  tenantId: string;
  userId: string;
  authenticatedAgentId: string;
  grant: {
    tenantId: string;
    userId: string;
    agentId: string;
    accountId: string;
    origin: string;
    scopes: string[];
    policyVersion: number;
    approvalId: string | null;
    taskId: string | null;
    executionContextId: string;
    operation: string;
    expiresAt: Date;
    revokedAt: Date | null;
    approvedAt: Date | null;
  };
  requestedAccountId: string;
  requestedOrigin: string;
  requestedScope: string;
  currentPolicyVersion: number;
  approval: ApprovalSnapshot | null;
  requestedTaskId: string | null;
  requestedExecutionContextId: string;
  requestedOperation: string;
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
        | "invalid_origin"
        | "origin_mismatch"
        | "scope_denied"
        | "policy_version_mismatch"
        | "approval_mismatch"
        | "approval_not_approved"
        | "task_mismatch"
        | "execution_context_mismatch"
        | "operation_mismatch"
        | "expired"
        | "revoked"
        | "not_approved";
    };

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
  if (!c.requestedAccountId || c.requestedAccountId !== g.accountId) {
    return { allowed: false, reason: "account_mismatch" };
  }
  if (
    !OriginSchema.safeParse(c.requestedOrigin).success ||
    !OriginSchema.safeParse(g.origin).success
  ) {
    return { allowed: false, reason: "invalid_origin" };
  }
  if (c.requestedOrigin !== g.origin) {
    return { allowed: false, reason: "origin_mismatch" };
  }
  if (!g.scopes.includes(c.requestedScope)) {
    return { allowed: false, reason: "scope_denied" };
  }
  if (
    !Number.isSafeInteger(c.currentPolicyVersion) ||
    c.currentPolicyVersion < 1 ||
    g.policyVersion !== c.currentPolicyVersion
  ) {
    return { allowed: false, reason: "policy_version_mismatch" };
  }

  const currentApprovalId = c.approval?.id ?? null;
  if (g.approvalId !== currentApprovalId) {
    return { allowed: false, reason: "approval_mismatch" };
  }
  if (c.approval !== null && c.approval.status !== "approved") {
    return { allowed: false, reason: "approval_not_approved" };
  }
  if (g.approvedAt === null) {
    return { allowed: false, reason: "not_approved" };
  }

  if (g.taskId !== c.requestedTaskId) {
    return { allowed: false, reason: "task_mismatch" };
  }
  if (
    !g.executionContextId ||
    !c.requestedExecutionContextId ||
    g.executionContextId !== c.requestedExecutionContextId
  ) {
    return { allowed: false, reason: "execution_context_mismatch" };
  }
  if (
    !g.operation ||
    !c.requestedOperation ||
    g.operation !== c.requestedOperation
  ) {
    return { allowed: false, reason: "operation_mismatch" };
  }
  if (g.expiresAt.getTime() <= c.now.getTime()) {
    return { allowed: false, reason: "expired" };
  }
  if (g.revokedAt !== null) {
    return { allowed: false, reason: "revoked" };
  }
  return { allowed: true };
}
