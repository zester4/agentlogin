import { randomBytes } from "node:crypto";

const MAX_SECRET_BYTES = 4_096;

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname === "localhost";
}

/**
 * Test-only HTTP provider for the local synthetic site.
 * It deliberately accepts only loopback HTTP and never follows redirects.
 * Production execution must use a separately authenticated worker and broker.
 */
export class SyntheticHttpLoginProvider {
  constructor({ baseUrl, leaseBroker, scenario = "success", fetchImpl = fetch }) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" || !isLoopback(url.hostname) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) {
      throw new TypeError("Synthetic provider must target a loopback HTTP origin.");
    }
    if (!leaseBroker || typeof leaseBroker.withConsumedLease !== "function") {
      throw new TypeError("A one-time test lease broker is required.");
    }
    if (scenario !== "success" && scenario !== "mfa") throw new TypeError("Unsupported synthetic scenario.");
    this.baseUrl = url.origin;
    this.leaseBroker = leaseBroker;
    this.scenario = scenario;
    this.fetchImpl = fetchImpl;
    this.handoffs = new Map();
  }

  async executeLogin(request) {
    const target = new URL(request.expectedOrigin);
    if (target.origin !== this.baseUrl || target.origin !== request.expectedOrigin ||
        request.deadline.getTime() <= Date.now()) {
      return { status: "login_failed", reasonCode: "unsupported_flow" };
    }

    try {
      return await this.leaseBroker.withConsumedLease(request.credentialLease, async (secret, binding) => {
        if (binding.tenantId !== request.tenantId || binding.userId !== request.userId ||
            binding.agentId !== request.agentId || binding.grantId !== request.grantId ||
            binding.accountId !== request.accountRef || binding.origin !== request.expectedOrigin ||
            binding.executionId !== request.executionId || binding.credentialId !== request.credentialId ||
            binding.recordVersion !== request.recordVersion) {
          return { status: "login_failed", reasonCode: "unsupported_flow" };
        }
        if (!(secret instanceof Uint8Array) || secret.byteLength < 1 || secret.byteLength > MAX_SECRET_BYTES) {
          return { status: "login_failed", reasonCode: "invalid_credentials" };
        }

        let credentials;
        try {
          credentials = JSON.parse(Buffer.from(secret).toString("utf8"));
        } catch {
          return { status: "login_failed", reasonCode: "invalid_credentials" };
        }
        if (typeof credentials.email !== "string" || typeof credentials.password !== "string") {
          return { status: "login_failed", reasonCode: "invalid_credentials" };
        }

        const response = await this.fetchImpl(
          this.baseUrl + "/login?scenario=" + this.scenario,
          { method: "POST", redirect: "manual", signal: AbortSignal.timeout(
            Math.max(1, Math.min(10_000, request.deadline.getTime() - Date.now()))
          ), headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ email: credentials.email, password: credentials.password, scenario: this.scenario }) }
        );

        if (response.status === 401) return { status: "login_failed", reasonCode: "invalid_credentials" };
        if (response.status !== 200 || response.headers.get("location")) {
          return { status: "login_failed", reasonCode: "site_unavailable" };
        }

        const cookies = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
        const sessionCookie = cookies.map((value) => value.split(";")[0])
          .find((value) => value.startsWith("agentlogin_test_session="));
        if (!sessionCookie) return { status: "login_failed", reasonCode: "unsupported_flow" };

        const sessionResponse = await this.fetchImpl(this.baseUrl + "/session", {
          method: "GET", redirect: "manual", headers: { cookie: sessionCookie },
          signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, request.deadline.getTime() - Date.now())))
        });
        if (!sessionResponse.ok) return { status: "login_failed", reasonCode: "site_unavailable" };
        const session = await sessionResponse.json();
        if (session.authenticated === true) return { status: "login_succeeded" };
        if (session.mfa_required === true) {
          const handoffRef = "mfa_" + randomBytes(18).toString("base64url");
          this.handoffs.set(handoffRef, { executionId: request.executionId, sessionCookie, expiresAt: request.deadline });
          return { status: "mfa_required", handoffRef };
        }
        return { status: "login_failed", reasonCode: "unsupported_flow" };
      });
    } catch {
      return { status: "login_failed", reasonCode: "site_unavailable" };
    }
  }

  async terminate(executionId) {
    for (const [ref, handoff] of this.handoffs) {
      if (handoff.executionId === executionId) this.handoffs.delete(ref);
    }
  }

  async healthCheck() {
    try {
      const response = await this.fetchImpl(this.baseUrl + "/health", {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(2_000)
      });
      return { available: response.ok };
    } catch {
      return { available: false };
    }
  }
}
