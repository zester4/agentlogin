import { describe, expect, it, vi } from "vitest";
import { ExecutionCoordinator } from "./coordinator.js";
import type { IsolatedBrowserProvider } from "./index.js";

const principal = { tenantId: "ten_1", userId: "usr_1", agentId: "agt_1", credentialId: "acred_1" };
const input = {
  principal, grantId: "grt_1", accountId: "acc_1", origin: "https://accounts.example.com",
  expectedPolicyVersion: 1
};
function setup(options: { allowed?: boolean; accountOrigin?: string; outcome?: any; auditFails?: boolean } = {}) {
  const authorize = vi.fn().mockResolvedValue(options.allowed === false
    ? { allowed: false, reason: "origin_mismatch" }
    : { allowed: true });
  const findLoginCredential = vi.fn().mockResolvedValue({
    credentialRef: "secret-ref-internal", credentialId: "cred_1", recordVersion: 1,
    origin: options.accountOrigin ?? input.origin, status: "active"
  });
  const executeLogin = vi.fn().mockResolvedValue(options.outcome ?? { status: "login_succeeded" });
  const terminate = vi.fn().mockResolvedValue(undefined);
  const append = vi.fn().mockImplementation(async () => { if (options.auditFails) throw new Error("audit unavailable"); });
  const coordinator = new ExecutionCoordinator(
    { authorize } as any,
    { findLoginCredential } as any,
    { executeLogin, terminate, healthCheck: vi.fn() } as unknown as IsolatedBrowserProvider,
    { append } as any,
    () => new Date("2026-11-07T12:00:00Z"),
    () => "exe_fixed"
  );
  return { coordinator, authorize, findLoginCredential, executeLogin, terminate, append };
}

describe("ExecutionCoordinator", () => {
  it("never starts a browser when the grant is denied and audits the denial", async () => {
    const s = setup({ allowed: false });
    const result = await s.coordinator.login(input);
    expect(result).toEqual({ status: "login_failed", execution_id: "exe_fixed", reason_code: "origin_mismatch" });
    expect(s.executeLogin).not.toHaveBeenCalled();
    expect(s.append).toHaveBeenCalledWith(expect.objectContaining({ status: "login_failed", reasonCode: "origin_mismatch" }));
  });

  it("requires an active account bound to the exact origin", async () => {
    const s = setup({ accountOrigin: "https://evil.example" });
    const result = await s.coordinator.login(input);
    expect(result).toMatchObject({ status: "login_failed", reason_code: "account_unavailable" });
    expect(s.executeLogin).not.toHaveBeenCalled();
  });

  it("passes only internal credential references and verified tenant context to the worker", async () => {
    const s = setup();
    const result = await s.coordinator.login(input);
    expect(result).toEqual({ status: "login_succeeded", execution_id: "exe_fixed" });
    expect(s.executeLogin).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "ten_1", userId: "usr_1", agentId: "agt_1", credentialRef: "secret-ref-internal",
      expectedOrigin: input.origin, grantId: "grt_1"
    }));
    expect(s.terminate).toHaveBeenCalledWith("exe_fixed");
  });

  it("preserves an isolated session for MFA handoff without exposing credentials", async () => {
    const s = setup({ outcome: { status: "mfa_required", handoffRef: "handoff_opaque" } });
    const result = await s.coordinator.login(input);
    expect(result).toEqual({ status: "mfa_required", execution_id: "exe_fixed", handoff_id: "handoff_opaque" });
    expect(s.terminate).not.toHaveBeenCalled();
  });

  it("destroys the browser session if the audit write fails", async () => {
    const s = setup({ auditFails: true });
    const result = await s.coordinator.login(input);
    expect(result).toMatchObject({ status: "login_failed", reason_code: "audit_unavailable" });
    expect(s.terminate).toHaveBeenCalledWith("exe_fixed");
  });

  it("rejects unreasonable execution timeouts before browser access", async () => {
    const s = setup();
    const result = await s.coordinator.login({ ...input, timeoutMs: 999 });
    expect(result).toMatchObject({ status: "login_failed", reason_code: "invalid_execution_policy" });
    expect(s.executeLogin).not.toHaveBeenCalled();
  });
});
