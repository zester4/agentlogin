import { describe, expect, it } from "vitest";
import { authorizeGrant, type AuthorizationContext } from "./index.js";

const context = (): AuthorizationContext => ({
  tenantId: "ten_1",
  userId: "usr_1",
  authenticatedAgentId: "agt_1",
  expectedPolicyVersion: 3,
  requestedAccountId: "acc_1",
  requestedOrigin: "https://example.com",
  requestedScope: "autofill_login",
  now: new Date("2026-01-01T00:00:00Z"),
  grant: {
    tenantId: "ten_1",
    userId: "usr_1",
    agentId: "agt_1",
    accountId: "acc_1",
    origin: "https://example.com",
    scopes: ["autofill_login"],
    policyVersion: 3,
    expiresAt: new Date("2026-01-01T00:05:00Z"),
    revokedAt: null,
    approvedAt: new Date("2025-12-31T23:00:00Z")
  }
});

describe("grant authorization", () => {
  it("allows an exact active grant", () => {
    expect(authorizeGrant(context())).toEqual({ allowed: true });
  });
  it("rejects a different tenant", () => {
    expect(authorizeGrant({ ...context(), tenantId: "ten_other" })).toMatchObject({ allowed: false, reason: "tenant_mismatch" });
  });
  it("rejects a different user", () => {
    expect(authorizeGrant({ ...context(), userId: "usr_other" })).toMatchObject({ allowed: false, reason: "user_mismatch" });
  });
  it("rejects a different agent", () => {
    expect(authorizeGrant({ ...context(), authenticatedAgentId: "agt_other" })).toMatchObject({ allowed: false, reason: "agent_mismatch" });
  });
  it("rejects a different account", () => {
    expect(authorizeGrant({ ...context(), requestedAccountId: "acc_other" })).toMatchObject({ allowed: false, reason: "account_mismatch" });
  });
  it("rejects a different origin", () => {
    expect(authorizeGrant({ ...context(), requestedOrigin: "https://evil.example.com" })).toMatchObject({ allowed: false, reason: "origin_mismatch" });
  });
  it("rejects a path-bearing origin even when its host matches", () => {
    expect(authorizeGrant({ ...context(), requestedOrigin: "https://example.com.evil/path" })).toMatchObject({ allowed: false, reason: "origin_mismatch" });
  });
  it("rejects non-HTTPS origins outside local development", () => {
    expect(authorizeGrant({ ...context(), requestedOrigin: "http://example.com" })).toMatchObject({ allowed: false, reason: "origin_mismatch" });
  });
  it("rejects an ungranted scope", () => {
    expect(authorizeGrant({ ...context(), requestedScope: "delete_account" })).toMatchObject({ allowed: false, reason: "scope_denied" });
  });
  it("rejects a stale policy version", () => {
    expect(authorizeGrant({ ...context(), expectedPolicyVersion: 4 })).toMatchObject({ allowed: false, reason: "policy_version_mismatch" });
  });
  it("rejects expiry", () => {
    expect(authorizeGrant({ ...context(), now: new Date("2027-01-01") })).toMatchObject({ allowed: false, reason: "expired" });
  });
  it("rejects invalid time values", () => {
    expect(authorizeGrant({ ...context(), now: new Date(Number.NaN) })).toMatchObject({ allowed: false, reason: "expired" });
  });
  it("rejects revocation", () => {
    expect(authorizeGrant({ ...context(), grant: { ...context().grant, revokedAt: new Date() } })).toMatchObject({ allowed: false, reason: "revoked" });
  });
  it("rejects a missing approval", () => {
    expect(authorizeGrant({ ...context(), grant: { ...context().grant, approvedAt: null } })).toMatchObject({ allowed: false, reason: "not_approved" });
  });
});
