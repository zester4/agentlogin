import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerTicket } from "@agentlogin/execution";
import { buildWorkerApp } from "./server.js";
import type { createDatabase } from "@agentlogin/database";
import { AwsKmsProvider } from "@agentlogin/vault";

const signingKey = Buffer.alloc(32, 17);
const database = {
  db: {},
  pool: {},
  close: vi.fn().mockResolvedValue(undefined)
} as unknown as ReturnType<typeof createDatabase>;

const apps: Array<Awaited<ReturnType<typeof buildWorkerApp>>> = [];

function makeApp() {
  const app = buildWorkerApp({
    signingKey,
    apiUrl: new URL("https://api.agentlogin.example"),
    database,
    kms: new AwsKmsProvider("alias/test-only", "us-east-1")
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("isolated login worker boundary", () => {
  it("exposes only a minimal health response", async () => {
    const app = makeApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "agentlogin-isolated-worker" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects requests without an internal worker ticket", async () => {
    const app = makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/executions/login",
      payload: {}
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a valid ticket when execution, tenant, or lease bindings differ", async () => {
    const app = makeApp();
    const ticket = createWorkerTicket({
      tenantId: "tenant_one",
      executionId: "exe_one",
      leaseId: "lease_one"
    }, signingKey);
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/executions/login",
      headers: { authorization: "Bearer " + ticket },
      payload: {
        executionId: "exe_two",
        tenantId: "tenant_one",
        userId: "user_one",
        agentId: "agent_one",
        grantId: "grant_one",
        accountRef: "account_one",
        expectedOrigin: "https://example.com",
        credentialId: "credential_one",
        recordVersion: 1,
        credentialLease: {
          leaseId: "lease_one",
          token: "x".repeat(43),
          expiresAt: new Date(Date.now() + 30_000).toISOString()
        },
        deadline: new Date(Date.now() + 30_000).toISOString()
      }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: "execution_ticket_mismatch" } });
  });

  it("does not expose worker routes through an unauthenticated termination request", async () => {
    const app = makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/executions/exe_one/terminate"
    });
    expect(response.statusCode).toBe(401);
  });
});
