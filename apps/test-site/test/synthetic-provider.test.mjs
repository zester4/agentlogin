import { after, before, describe, expect, it, vi } from "vitest";
import { createTestSiteServer } from "../src/server.mjs";
import { SyntheticHttpLoginProvider } from "../src/synthetic-provider.mjs";

const principal = {
  tenantId: "tenant_test", userId: "user_test", agentId: "agent_test",
  grantId: "grant_test", accountId: "account_test", origin: ""
};
let server;
let baseUrl;

function makeBroker(secret) {
  const consumed = new Set();
  return {
    withConsumedLease: vi.fn(async (lease, operation) => {
      if (consumed.has(lease.leaseId)) throw new Error("lease already consumed");
      consumed.add(lease.leaseId);
      const binding = {
        tenantId: principal.tenantId, userId: principal.userId, agentId: principal.agentId,
        grantId: principal.grantId, accountId: principal.accountId, origin: baseUrl,
        executionId: "execution_test", credentialId: "credential_test", recordVersion: 1
      };
      const bytes = Buffer.from(JSON.stringify(secret));
      try { return await operation(bytes, binding); }
      finally { bytes.fill(0); }
    })
  };
}

function makeRequest() {
  return {
    executionId: "execution_test", tenantId: principal.tenantId, userId: principal.userId,
    agentId: principal.agentId, grantId: principal.grantId, accountRef: principal.accountId,
    expectedOrigin: baseUrl, credentialId: "credential_test", recordVersion: 1,
    credentialLease: { leaseId: "lease_test", token: "opaque-test-token", expiresAt: new Date(Date.now() + 30_000) },
    deadline: new Date(Date.now() + 30_000)
  };
}

before(async () => {
  server = createTestSiteServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  principal.origin = baseUrl;
});

after(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("SyntheticHttpLoginProvider", () => {
  it("authenticates a synthetic account using a consumed one-time lease", async () => {
    const broker = makeBroker({ email: "agentlogin-test@example.com", password: "agentlogin-synthetic-password" });
    const provider = new SyntheticHttpLoginProvider({ baseUrl, leaseBroker: broker });
    await expect(provider.executeLogin(makeRequest())).resolves.toEqual({ status: "login_succeeded" });
    expect(broker.withConsumedLease).toHaveBeenCalledTimes(1);
  });

  it("returns a safe failure for invalid credentials", async () => {
    const broker = makeBroker({ email: "agentlogin-test@example.com", password: "wrong-password" });
    const provider = new SyntheticHttpLoginProvider({ baseUrl, leaseBroker: broker });
    await expect(provider.executeLogin(makeRequest())).resolves.toEqual({
      status: "login_failed", reasonCode: "invalid_credentials"
    });
  });

  it("returns an MFA handoff without exposing the session cookie", async () => {
    const broker = makeBroker({ email: "agentlogin-test@example.com", password: "agentlogin-synthetic-password" });
    const provider = new SyntheticHttpLoginProvider({ baseUrl, leaseBroker: broker, scenario: "mfa" });
    const result = await provider.executeLogin(makeRequest());
    expect(result.status).toBe("mfa_required");
    expect(result.handoffRef).toMatch(/^mfa_/);
    expect(JSON.stringify(result)).not.toContain("agentlogin_test_session");
    expect(provider.handoffs.size).toBe(1);
    await provider.terminate("execution_test");
    expect(provider.handoffs.size).toBe(0);
  });

  it("rejects an origin mismatch before consuming a lease", async () => {
    const broker = makeBroker({ email: "agentlogin-test@example.com", password: "agentlogin-synthetic-password" });
    const provider = new SyntheticHttpLoginProvider({ baseUrl, leaseBroker: broker });
    await expect(provider.executeLogin({ ...makeRequest(), expectedOrigin: "https://evil.example" })).resolves.toEqual({
      status: "login_failed", reasonCode: "unsupported_flow"
    });
    expect(broker.withConsumedLease).not.toHaveBeenCalled();
  });

  it("refuses non-loopback and HTTPS targets", () => {
    const leaseBroker = makeBroker({});
    expect(() => new SyntheticHttpLoginProvider({ baseUrl: "https://example.com", leaseBroker })).toThrow();
    expect(() => new SyntheticHttpLoginProvider({ baseUrl: "http://example.com", leaseBroker })).toThrow();
  });
});
