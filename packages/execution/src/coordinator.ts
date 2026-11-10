import { randomBytes } from "node:crypto";
import { ExecutionResultSchema, type ExecutionResult, type GrantScope } from "@agent-login/contracts";
import type { GrantLifecycleService, GrantRequestPrincipal } from "@agentlogin/policy";
import type { IsolatedBrowserProvider } from "./index.js";

export type LoginCredentialReference = {
  credentialRef: string; credentialId: string; recordVersion: number;
  origin: string; status: "active" | "revoked" | "disabled";
};
export interface LoginAccountRepository {
  findLoginCredential(input: { tenantId: string; accountId: string; userId: string }): Promise<LoginCredentialReference | null>;
}
export type CredentialLeaseBinding = {
  tenantId: string; userId: string; agentId: string; grantId: string;
  accountId: string; credentialRef: string; credentialId: string;
  recordVersion: number; origin: string; executionId: string; expiresAt: Date;
};
export type CredentialLease = { leaseId: string; token: string; expiresAt: Date };
export interface CredentialLeaseIssuer {
  issue(input: CredentialLeaseBinding): Promise<CredentialLease>;
  revoke(leaseId: string): Promise<void>;
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
    private readonly leases: CredentialLeaseIssuer,
    private readonly browser: IsolatedBrowserProvider,
    private readonly audit: ExecutionAuditRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => "exe_" + randomBytes(18).toString("base64url")
  ) {}

  async login(input: {
    principal: AgentExecutionPrincipal; grantId: string; accountId: string;
    origin: string; taskId?: string; scope?: GrantScope;
    expectedPolicyVersion: number; timeoutMs?: number;
  }): Promise<ExecutionResult> {
    const startedAt = this.now();
    const executionId = this.newId();
    const scope = input.scope ?? "autofill_login";
    const timeoutMs = input.timeoutMs ?? 60_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
      return this.failure(input, executionId, startedAt, "invalid_execution_policy");
    }

    let decision: Awaited<ReturnType<GrantLifecycleService["authorize"]>>;
    try {
      decision = await this.grants.authorize({
        principal: input.principal, grantId: input.grantId, accountId: input.accountId,
        origin: input.origin, scope, expectedPolicyVersion: input.expectedPolicyVersion
      });
    } catch {
      return this.failure(input, executionId, startedAt, "provider_unavailable");
    }
    if (!decision.allowed) return this.failure(input, executionId, startedAt, decision.reason);

    let account: LoginCredentialReference | null;
    try {
      account = await this.accounts.findLoginCredential({
        tenantId: input.principal.tenantId, accountId: input.accountId, userId: input.principal.userId
      });
    } catch {
      return this.failure(input, executionId, startedAt, "account_unavailable");
    }
    if (!account || account.status !== "active" || account.origin !== input.origin ||
        !account.credentialRef || !account.credentialId || !Number.isSafeInteger(account.recordVersion) || account.recordVersion < 1) {
      return this.failure(input, executionId, startedAt, "account_unavailable");
    }

    const deadline = new Date(startedAt.getTime() + timeoutMs);
    let lease: CredentialLease | undefined;
    try {
      lease = await this.leases.issue({
        tenantId: input.principal.tenantId, userId: input.principal.userId,
        agentId: input.principal.agentId, grantId: input.grantId,
        accountId: input.accountId, credentialRef: account.credentialRef,
        credentialId: account.credentialId, recordVersion: account.recordVersion,
        origin: input.origin, executionId, expiresAt: deadline
      });
      if (!lease.leaseId || !lease.token || lease.expiresAt.getTime() > deadline.getTime() ||
          lease.expiresAt.getTime() <= this.now().getTime()) {
        throw new Error("Credential lease issuer returned an invalid lease.");
      }
    } catch {
      if (lease?.leaseId) await this.leases.revoke(lease.leaseId).catch(() => undefined);
      return this.failure(input, executionId, startedAt, "provider_unavailable");
    }
    if (!lease) return this.failure(input, executionId, startedAt, "provider_unavailable");

    let outcome: Awaited<ReturnType<IsolatedBrowserProvider["executeLogin"]>>;
    try {
      outcome = await this.browser.executeLogin({
        executionId, tenantId: input.principal.tenantId, userId: input.principal.userId,
        agentId: input.principal.agentId, grantId: input.grantId,
        accountRef: input.accountId, expectedOrigin: input.origin,
        credentialLease: lease, credentialId: account.credentialId,
        recordVersion: account.recordVersion, ...(input.taskId ? { taskId: input.taskId } : {}),
        deadline
      });
    } catch {
      outcome = { status: "login_failed", reasonCode: "site_unavailable" };
    } finally {
      await this.leases.revoke(lease.leaseId).catch(() => undefined);
    }

    const completedAt = this.now();
    const mapped = outcome.status === "login_succeeded"
      ? { status: "login_succeeded" as const, execution_id: executionId }
      : outcome.status === "mfa_required"
        ? { status: "mfa_required" as const, execution_id: executionId, handoff_id: outcome.handoffRef }
        : outcome.status === "user_action_required"
          ? { status: "user_action_required" as const, execution_id: executionId, action_id: outcome.actionRef }
          : { status: "login_failed" as const, execution_id: executionId, reason_code: outcome.reasonCode };

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
      await this.browser.terminate(executionId).catch(() => undefined);
      return { status: "login_failed", execution_id: executionId, reason_code: "audit_unavailable" };
    }

    if (safeResult.status === "login_succeeded" || safeResult.status === "login_failed") {
      await this.browser.terminate(executionId).catch(() => undefined);
    }
    return safeResult;
  }

  private async failure(
    input: { principal: AgentExecutionPrincipal; grantId: string; accountId: string; origin: string },
    executionId: string, startedAt: Date,
    reasonCode: Extract<ExecutionResult, { status: "login_failed" }>["reason_code"]
  ): Promise<ExecutionResult> {
    const completedAt = this.now();
    try {
      await this.audit.append({
        executionId, tenantId: input.principal.tenantId, agentId: input.principal.agentId,
        grantId: input.grantId, accountId: input.accountId, origin: input.origin,
        status: "login_failed", reasonCode, startedAt, completedAt
      });
    } catch {
      return { status: "login_failed", execution_id: executionId, reason_code: "audit_unavailable" };
    }
    return { status: "login_failed", execution_id: executionId, reason_code: reasonCode };
  }
}
