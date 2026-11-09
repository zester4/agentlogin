import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createTestSiteServer } from "../src/server.mjs";
import { SyntheticHttpLoginProvider } from "../src/synthetic-provider.mjs";

const principal = {
  tenantId: "tenant_test", userId: "user_test", agentId: "agent_test",
  grantId: "grant_test", accountId: "account_test"
};
let server;
let baseUrl;

function makeBroker(secret) {
  const consumed = new Set();
  let calls = 0;
  return {
    get calls() { return calls; },
    async withConsumedLease(lease, operation) {
      calls += 1;
      if (consumed.has(lease.leaseId)) throw new Error("lease already consumed");
      consumed.add(lease.leaseId);
      const binding = {
        ...principal, origin: baseUrl, executionId: "execution_test",
        credentialId: "credential_test", recordVersion: 1
      };
      const bytes = Buffer.from(JSON.stringify(secret));
      try { return await operation(bytes, binding); }
      finally { bytes.fill(0); }
    }
  };
}

function makeRequest() {
  return {
    executionId: "execution_test", ...principal, accountRef: principal.accountId,
    expectedOrigin: baseUrl, credentialId: "credential_test", recordVersion: 1,
    credentialLease: { leaseId: "lease_test", token: "opaque-test-token", expiresAt: new Date(Date.now() + 30_000) },
    deadline: new Date(Date.now() + 30_000)
  };
}

before(async () => {
  server = createTestSiteServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("SyntheticHttpLoginProvider", () => {
  it("authenticates a synthetic account using a consumed one-time lease", async () => {
    const broker = makeBroker({ email: "agentlogin-test@example.com", password: "agentlogin-synthetic-password" });
    const provider = new SyntheticHttpLoginProvider({ baseUrl, leaseBroker: broker });
    assert.deepEqual(await provider.executeLogin(makeRequest()), { status: "login_succeeded" });
    assert.equal(broker.calls, 1);
  });

  it("returns a safe failure for invalid credentials", async () => {
    const broker = makeBroker({ email: "agentlogin-test@example.com", password: "wrong-password" });
    const provider = new SyntheticHttpLoginProvider({ baseUrl, leaseBroker: broker });
    assert.deepEqual(await provider.executeLogin(makeRequest()), {
      status: "login_failed", reasonCode: "invalid_credentials"
    });
  });

  it("returns an MFA handoff without exposing the session cookie", async () => {
    const broker = makeBroker({ email: "agentlogin-test@example.com", password: "agentlogin-synthetic-password" });
    const provider = new SyntheticHttpLoginProvider({ baseUrl, leaseBroker: broker, scenario: "mfa" });
    const result = await provider.executeLogin(makeRequest());
    assert.equal(result.status, "mfa_required");
    assert.match(result.handoffRef, /^mfa_/);
    assert.equal(JSON.stringify(result).includes("agentlogin_test_session"), false);
    assert.equal(provider.handoffs.size, 1);
    await provider.terminate("execution_test");
    assert.equal(provider.handoffs.size, 0);
  });

  it("rejects an origin mismatch before consuming a lease", async () => {
    const broker = makeBroker({ email: "agentlogin-test@example.com", password: "agentlogin-synthetic-password" });
    const provider = new SyntheticHttpLoginProvider({ baseUrl, leaseBroker: broker });
    assert.deepEqual(await provider.executeLogin({ ...makeRequest(), expectedOrigin: "https://evil.example" }), {
      status: "login_failed", reasonCode: "unsupported_flow"
    });
    assert.equal(broker.calls, 0);
  });

  it("refuses non-loopback and HTTPS targets", () => {
    const leaseBroker = makeBroker({});
    assert.throws(() => new SyntheticHttpLoginProvider({ baseUrl: "https://example.com", leaseBroker }));
    assert.throws(() => new SyntheticHttpLoginProvider({ baseUrl: "http://example.com", leaseBroker }));
  });
});
