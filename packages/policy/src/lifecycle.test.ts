import { describe, expect, it } from "vitest";
import {
  GrantLifecycleService, GrantLifecycleError, type GrantLifecycleRecord,
  type GrantLifecycleRepository
} from "./lifecycle.js";

class MemoryGrants implements GrantLifecycleRepository {
  delegated = true;
  record: GrantLifecycleRecord | null = null;
  async hasActiveDelegation() { return this.delegated; }
  async createPending(input: Parameters<GrantLifecycleRepository["createPending"]>[0]) {
    const approvalId = input.id + "_approval";
    this.record = {
      ...input, approvalId, revokedAt: null, approvedAt: null, approvalDecision: "pending",
      tenantStatus: "active", userStatus: "active", agentStatus: "active",
      developerStatus: "active", accountStatus: "active"
    };
    return { grantId: input.id, approvalId };
  }
  async find(id: string) { return this.record?.id === id ? this.record : null; }
  async decide(input: Parameters<GrantLifecycleRepository["decide"]>[0]) {
    if (!this.record || this.record.approvalId !== input.approvalId || this.record.approvalDecision !== "pending") return false;
    this.record.approvalDecision = input.decision;
    this.record.approvedAt = input.decision === "approved" ? input.decidedAt : null;
    return true;
  }
  async revoke(id: string, at: Date) {
    if (!this.record || this.record.id !== id || this.record.revokedAt) return false;
    this.record.revokedAt = at; return true;
  }
}
const now = () => new Date("2026-11-07T12:00:00.000Z");
const principal = { tenantId: "ten_1", userId: "usr_1", agentId: "agt_1" };
const request = { account_id: "acc_1", origin: "https://accounts.example.com", scopes: ["autofill_login"], requested_ttl_seconds: 300 };

describe("grant lifecycle", () => {
  it("requires explicit active delegation before creating a pending grant", async () => {
    const repo = new MemoryGrants(); repo.delegated = false;
    const service = new GrantLifecycleService(repo, now, () => "fixed-id");
    await expect(service.request(principal, request)).rejects.toMatchObject({ code: "delegation_required" });
    expect(repo.record).toBeNull();
  });

  it("creates a short-lived pending approval and does not return an approved grant", async () => {
    const repo = new MemoryGrants();
    const service = new GrantLifecycleService(repo, now, () => "fixed-id");
    const result = await service.request(principal, request);
    expect(result).toMatchObject({ status: "pending_approval", grant_id: "grt_fixed-id" });
    expect(repo.record?.approvalDecision).toBe("pending");
    expect(result.expires_at).toBe("2026-11-07T12:05:00.000Z");
  });

  it("only the owning user can approve", async () => {
    const repo = new MemoryGrants();
    const service = new GrantLifecycleService(repo, now, () => "fixed-id");
    const pending = await service.request(principal, request);
    await expect(service.decide({
      principal: { tenantId: "ten_1", userId: "usr_other" },
      grantId: pending.grant_id, approvalId: pending.approval_id, decision: "approved"
    })).rejects.toMatchObject({ code: "not_owner" });
  });

  it("allows only an approved exact-origin, exact-account, exact-scope grant", async () => {
    const repo = new MemoryGrants();
    const service = new GrantLifecycleService(repo, now, () => "fixed-id");
    const pending = await service.request(principal, request);
    await service.decide({ principal: { tenantId: "ten_1", userId: "usr_1" }, grantId: pending.grant_id, approvalId: pending.approval_id, decision: "approved" });
    const base = { principal, grantId: pending.grant_id, accountId: "acc_1", origin: "https://accounts.example.com", scope: "autofill_login" as const, expectedPolicyVersion: 1 };
    await expect(service.authorize(base)).resolves.toEqual({ allowed: true });
    await expect(service.authorize({ ...base, origin: "https://evil.example" })).resolves.toMatchObject({ allowed: false, reason: "origin_mismatch" });
    await expect(service.authorize({ ...base, accountId: "acc_2" })).resolves.toMatchObject({ allowed: false, reason: "account_mismatch" });
  });

  it("rechecks live entity status on every authorization", async () => {
    const repo = new MemoryGrants();
    const service = new GrantLifecycleService(repo, now, () => "fixed-id");
    const pending = await service.request(principal, request);
    await service.decide({ principal: { tenantId: "ten_1", userId: "usr_1" }, grantId: pending.grant_id, approvalId: pending.approval_id, decision: "approved" });
    repo.record!.agentStatus = "suspended";
    await expect(service.authorize({
      principal, grantId: pending.grant_id, accountId: "acc_1",
      origin: request.origin, scope: "autofill_login", expectedPolicyVersion: 1
    })).resolves.toMatchObject({ allowed: false, reason: "agent_mismatch" });
  });

  it("does not allow approval after grant expiry", async () => {
    const repo = new MemoryGrants();
    const service = new GrantLifecycleService(repo, now, () => "fixed-id");
    const pending = await service.request(principal, request);
    const late = new GrantLifecycleService(repo, () => new Date("2026-11-07T12:06:00Z"), () => "unused");
    await expect(late.decide({ principal: { tenantId: "ten_1", userId: "usr_1" }, grantId: pending.grant_id, approvalId: pending.approval_id, decision: "approved" }))
      .rejects.toBeInstanceOf(GrantLifecycleError);
  });

  it("rejects a second approval decision and enforces revocation", async () => {
    const repo = new MemoryGrants();
    const service = new GrantLifecycleService(repo, now, () => "fixed-id");
    const pending = await service.request(principal, request);
    const decision = { principal: { tenantId: "ten_1", userId: "usr_1" }, grantId: pending.grant_id, approvalId: pending.approval_id, decision: "approved" as const };
    expect(await service.decide(decision)).toBe(true);
    expect(await service.decide(decision)).toBe(false);
    expect(await service.revoke({ tenantId: "ten_1", userId: "usr_1" }, pending.grant_id)).toBe(true);
    await expect(service.authorize({ principal, grantId: pending.grant_id, accountId: "acc_1", origin: request.origin, scope: "autofill_login", expectedPolicyVersion: 1 }))
      .resolves.toMatchObject({ allowed: false, reason: "revoked" });
  });
});
