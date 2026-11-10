import { describe, expect, it, vi } from "vitest";
import { HttpIsolatedBrowserProvider } from "./http-worker-provider.js";
import type { LoginExecutionRequest } from "./index.js";
import { verifyWorkerTicket } from "./worker-ticket.js";

const key = Buffer.alloc(32, 9);
const request: LoginExecutionRequest = {
  executionId: "exe_test", tenantId: "tenant_test", userId: "user_test",
  agentId: "agent_test", grantId: "grant_test", accountRef: "account_test",
  expectedOrigin: "https://accounts.example.test",
  credentialLease: {
    leaseId: "lease_test", token: "x".repeat(43),
    expiresAt: new Date(Date.now() + 30_000)
  },
  credentialId: "credential_test", recordVersion: 1,
  deadline: new Date(Date.now() + 20_000)
};

describe("HttpIsolatedBrowserProvider", () => {
  it("sends a short-lived execution-bound ticket and lease only to the private worker", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "login_succeeded" }), { status: 200 }));
    const provider = new HttpIsolatedBrowserProvider({
      workerUrl: "http://agentlogin-worker.railway.internal",
      signingKey: key, fetchImpl
    });
    await expect(provider.executeLogin(request)).resolves.toEqual({ status: "login_succeeded" });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://agentlogin-worker.railway.internal/internal/v1/executions/login");
    const headers = new Headers(init.headers);
    const claims = verifyWorkerTicket(headers.get("authorization")!.slice(7), key);
    expect(claims).toMatchObject({ tenantId: "tenant_test", executionId: "exe_test", leaseId: "lease_test" });
    const body = JSON.parse(String(init.body));
    expect(body.credentialLease.token).toBe("x".repeat(43));
    expect(body).not.toHaveProperty("credentialRef");
  });

  it("rejects public plaintext HTTP and URL credentials", () => {
    expect(() => new HttpIsolatedBrowserProvider({ workerUrl: "http://worker.example.com", signingKey: key })).toThrow();
    expect(() => new HttpIsolatedBrowserProvider({ workerUrl: "https://user:pass@worker.example.com", signingKey: key })).toThrow();
  });

  it("allows localhost only when explicitly enabled for local tests", () => {
    expect(() => new HttpIsolatedBrowserProvider({ workerUrl: "http://127.0.0.1:4100", signingKey: key })).toThrow();
    expect(() => new HttpIsolatedBrowserProvider({
      workerUrl: "http://127.0.0.1:4100", signingKey: key, allowInsecureLocalhost: true
    })).not.toThrow();
  });

  it("maps malformed worker responses to a safe failure", async () => {
    const provider = new HttpIsolatedBrowserProvider({
      workerUrl: "https://worker.example.com", signingKey: key,
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "login_succeeded", cookie: "secret" }), { status: 200 }))
    });
    await expect(provider.executeLogin(request)).resolves.toEqual({ status: "login_failed", reasonCode: "unsupported_flow" });
  });

  it("reports worker health without exposing an execution ticket", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const provider = new HttpIsolatedBrowserProvider({ workerUrl: "https://worker.example.com", signingKey: key, fetchImpl });
    await expect(provider.healthCheck()).resolves.toEqual({ available: true });
    expect(new Headers((fetchImpl.mock.calls[0] as [string, RequestInit])[1].headers).has("authorization")).toBe(false);
  });
});
