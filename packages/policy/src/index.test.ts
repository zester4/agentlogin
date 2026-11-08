import { describe, expect, it } from "vitest";
import { authorizeGrant, type AuthorizationContext } from "./index.js";

const context = (): AuthorizationContext => ({
  tenantId: "ten_1",
  userId: "usr_1",
  authenticatedAgentId: "agt_1",
  requestedAccountId: "acc_1",
  requestedOrigin: "https://example.com",
  requestedScope: "autofill_login",
  currentPolicyVersion: 3,
  approval: { id: "apr_1", status: "approved" },
  requestedTaskId: "task_1",
  requestedExecutionContextId: "ctx_1",
  requestedOperation: "autofill_login",
  now: new Date("2026-01-01T00:00:00Z"),
  grant: {
    tenantId: "ten_1",
    userId: "usr_1",
    agentId: "agt_1",
    accountId: "acc_1",
    origin: "https://example.com",
    scopes: ["autofill_login"],
    policyVersion: 3,
    approvalId: "apr_1",
    taskId: "task_1",
    executionContextId: "ctx_1",
    operation: "autofill_login",
    expiresAt: new Date("2026-01-01T00:05:00Z"),
    revokedAt: null,
    approvedAt: new Date("2025-12-31T23:00:00Z")
  }
});

describe("grant authorization", () => {
  it("allows an exact active grant with current policy and execution context", () => {
    expect(authorizeGrant(context())).toEqual({ allowed: true });
  });

  it("rejects a different tenant", () => {
    expect(authorizeGrant({ ...context(), tenantId: "ten_other" })).toMatchObject({
      allowed: false,
      reason: "tenant_mismatch"
    });
  });

  it("rejects a different user", () => {
    expect(authorizeGrant({ ...context(), userId: "usr_other" })).toMatchObject({
      allowed: false,
      reason: "user_mismatch"
    });
  });

  it("rejects a different authenticated agent", () => {
    expect(authorizeGrant({ ...context(), authenticatedAgentId: "agt_other" })).toMatchObject({
      allowed: false,
      reason: "agent_mismatch"
    });
  });

  it("rejects a different connected account", () => {
    expect(authorizeGrant({ ...context(), requestedAccountId: "acc_other" })).toMatchObject({
      allowed: false,
      reason: "account_mismatch"
    });
  });

  it("rejects a different origin", () => {
    expect(authorizeGrant({ ...context(), requestedOrigin: "https://evil.example.com" })).toMatchObject({
      allowed: false,
      reason: "origin_mismatch"
    });
  });

  it("rejects a non-canonical origin", () => {
    expect(authorizeGrant({ ...context(), requestedOrigin: "https://example.com/" })).toMatchObject({
      allowed: false,
      reason: "invalid_origin"
    });
  });

  it("rejects a missing scope", () => {
    expect(authorizeGrant({ ...context(), requestedScope: "account_write" })).toMatchObject({
      allowed: false,
      reason: "scope_denied"
    });
  });

  it("rejects a stale policy version", () => {
    expect(authorizeGrant({ ...context(), currentPolicyVersion: 4 })).toMatchObject({
      allowed: false,
      reason: "policy_version_mismatch"
    });
  });

  it("rejects a missing approval snapshot for an approval-bound grant", () => {
    expect(authorizeGrant({ ...context(), approval: null })).toMatchObject({
      allowed: false,
      reason: "approval_mismatch"
    });
  });

  it("rejects an approval that is no longer approved", () => {
    expect(authorizeGrant({
      ...context(),
      approval: { id: "apr_1", status: "denied" }
    })).toMatchObject({ allowed: false, reason: "approval_not_approved" });
  });

  it("rejects a different approval reference", () => {
    expect(authorizeGrant({
      ...context(),
      approval: { id: "apr_other", status: "approved" }
    })).toMatchObject({ allowed: false, reason: "approval_mismatch" });
  });

  it("rejects a different task", () => {
    expect(authorizeGrant({ ...context(), requestedTaskId: "task_other" })).toMatchObject({
      allowed: false,
      reason: "task_mismatch"
    });
  });

  it("rejects a different execution context", () => {
    expect(authorizeGrant({
      ...context(),
      requestedExecutionContextId: "ctx_other"
    })).toMatchObject({ allowed: false, reason: "execution_context_mismatch" });
  });

  it("rejects a different operation", () => {
    expect(authorizeGrant({ ...context(), requestedOperation: "account_write" })).toMatchObject({
      allowed: false,
      reason: "operation_mismatch"
    });
  });

  it("rejects expiry", () => {
    expect(authorizeGrant({ ...context(), now: new Date("2027-01-01") })).toMatchObject({
      allowed: false,
      reason: "expired"
    });
  });

  it("rejects revocation", () => {
    expect(authorizeGrant({
      ...context(),
      grant: { ...context().grant, revokedAt: new Date() }
    })).toMatchObject({ allowed: false, reason: "revoked" });
  });

  it("rejects an unapproved grant", () => {
    expect(authorizeGrant({
      ...context(),
      grant: { ...context().grant, approvedAt: null }
    })).toMatchObject({ allowed: false, reason: "not_approved" });
  });
});
