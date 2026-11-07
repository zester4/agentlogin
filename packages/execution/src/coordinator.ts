import { randomBytes } from "node:crypto";
import { ExecutionResultSchema, type ExecutionResult, type GrantScope } from "@agentlogin/contracts";
import type { GrantLifecycleService, GrantRequestPrincipal } from "@agentlogin/policy";
import type { IsolatedBrowserProvider } from "./index.js";

export type LoginCredentialReference = {
  credentialRef: string;
  credentialId: string;
  recordVersion: number;
  origin: string;
  status: "active" | "revoked" | "disabled";
};
export interface LoginAccountRepository {
  findLoginCredential(input: { tenantId: string; accountId: string; userId: string }): Promise<LoginCredentialReference | null>;
}
export interface ExecutionAuditRepository {
  append(input: {
    executionId: string; tenantId: string; agentId: string; grantId: string;
    accountId: string; origin: string; status: string; reasonCode?: string;
    startedAt: Date; completedAt: Date;
  }): Promise<void>;
}
export type AgentExecutionPrincipal = GrantRequestPrincipal & { credentialId: string };

export class ExecutionCoordinator {
  constructor(
    private readonly grants: Pick<GrantLifecycleService, "authorize">,
    private readonly accounts: LoginAccountRepository,
    private readonly browser: IsolatedBrowserProvider,
    private readonly audit: ExecutionAuditRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => "exe_" + randomBytes(18).toString("base64url")
  ) {}

  async login(input: {
    principal: AgentExecutionPrincipal;
    grantId: string;
    accountId: string;
    origin: string;
    taskId?: string;
    scope?: GrantScope;
    expectedPolicyVersion: number;
    timeoutMs?: number;
  }): Promise<ExecutionResult> {
    const startedAt = this.now();
    const executionId = this.newId();
    const scope = input.scope ?? "autofill_login";
    const timeoutMs = input.timeoutMs ?? 60_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
      return { status: "login_failed", execution_id: executionId, reason_code: "invalid_execution_policy" };
    }

    const decision = await this.grants.authorize({
      principal: input.principal, grantId: input.grantId, accountId: input.accountId,
      origin: input.origin, scope, expectedPolicyVersion: input.expectedPolicyVersion
    });
    if (!decision.allowed) {
      return { status: "login_failed", execution_id: executionId, reason_code: decision.reason };
    }

    const account = await this.accounts.findLoginCredential({
      tenantId: input.principal.tenantId, accountId: input.accountId, userId: input.principal.userId
    });
    if (!account || account.status !== "active" || account.origin !== input.origin) {
      return { status: "login_failed", execution_id: executionId, reason_code: "account_unavailable" };
    }

    let outcome: Awaited<ReturnType<IsolatedBrowserProvider["executeLogin"]>>;
    try {
      outcome = await this.browser.executeLogin({
        executionId, grantId: input.grantId, accountRef: input.accountId,
        expectedOrigin: input.origin, credentialRef: account.credentialRef,
        deadline: new Date(startedAt.getTime() + timeoutMs)
      });
    } catch {
      outcome = { status: "login_failed", reasonCode: "site_unavailable" };
    }

    const completedAt = this.now();
    const mapped = outcome.status === "login_succeeded"
      ? { status: "login_succeeded" as const, execution_id: executionId }
      : outcome.status === "mfa_required"
        ? { status: "mfa_required" as const, execution_id: executionId, handoff_id: outcome.handoffRef }
        : outcome.status === "user_action_required"
          ? { status: "user_action_required" as const, execution_id: executionId, action_id: outcome.actionRef }
          : { status: "login_failed" as const, execution_id: executionId, reason_code: outcome.reasonCode };

    // Strict schema parsing is the agent-facing output boundary. Unknown
    // provider fields (including accidental secret-bearing fields) are rejected.
    const parsed = ExecutionResultSchema.safeParse(mapped);
    const safeResult: ExecutionResult = parsed.success
      ? parsed.data
      : { status: "login_failed", execution_id: executionId, reason_code: "provider_unavailable" };

    try {
      await this.audit.append({
        executionId, tenantId: input.principal.tenantId, agentId: input.principal.agentId,
        grantId: input.grantId, accountId: input.accountId, origin: input.origin,
        status: safeResult.status,
        ...(safeResult.status === "login_failed" ? { reasonCode: safeResult.reason_code } : {}),
        startedAt, completedAt
      });
    } catch {
      // Fail closed: if an execution cannot be audited, revoke the session
      // rather than returning a success result that has no audit trail.
      await this.browser.terminate(executionId).catch(() => undefined);
      return { status: "login_failed", execution_id: executionId, reason_code: "audit_unavailable" };
    }

    if (safeResult.status === "login_succeeded" || safeResult.status === "login_failed") {
      await this.browser.terminate(executionId).catch(() => undefined);
    }
    return safeResult;
  }
}
