import { afterAll, describe, expect, it, vi } from "vitest";
import { createAgentLoginMcpApp } from "./app.js";

const identity = {
  authenticated: true,
  principal: { tenant_id: "ten_1", developer_id: "dev_1", agent_id: "agt_1", credential_id: "acred_1" }
};

describe("AgentLogin MCP HTTP boundary", () => {
  const app = createAgentLoginMcpApp({
    apiBaseUrl: "https://api.agentlogin.test",
    allowedHosts: ["mcp.agentlogin.test"],
    allowedOrigins: ["https://dashboard.agentlogin.test"],
    fetch: vi.fn<typeof fetch>()
  });

  afterAll(async () => app.close());

  it("serves an unauthenticated health endpoint", async () => {
    const response = await app.inject({ method: "GET", url: "/health", headers: { host: "mcp.agentlogin.test" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "agentlogin-mcp" });
  });

  it("allows Railway health probes with a platform-internal Host header", async () => {
    const response = await app.inject({ method: "GET", url: "/health", headers: { host: "agentlogin-mcp.railway.internal" } });
    expect(response.statusCode).toBe(200);
  });

  it("rejects a Host header outside the allowlist on the MCP route", async () => {
    const response = await app.inject({ method: "POST", url: "/mcp", headers: { host: "evil.example" }, payload: {} });
    expect(response.statusCode).toBe(403);
  });

  it("accepts an allowlisted MCP hostname with a port", async () => {
    const response = await app.inject({
      method: "POST", url: "/mcp",
      headers: { host: "mcp.agentlogin.test:4010" },
      payload: {}
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a missing Host header on the MCP route", async () => {
    const response = await app.inject({ method: "POST", url: "/mcp", headers: {}, payload: {} });
    expect(response.statusCode).toBe(403);
  });

  it("rejects an Origin not explicitly allowlisted", async () => {
    const response = await app.inject({
      method: "POST", url: "/mcp",
      headers: { host: "mcp.agentlogin.test", origin: "https://evil.example" },
      payload: {}
    });
    expect(response.statusCode).toBe(403);
  });

  it("rejects a missing bearer token before calling the API", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const isolated = createAgentLoginMcpApp({
      apiBaseUrl: "https://api.agentlogin.test",
      allowedHosts: ["mcp.agentlogin.test"],
      allowedOrigins: ["https://dashboard.agentlogin.test"],
      fetch: fetcher
    });
    const response = await isolated.inject({
      method: "POST", url: "/mcp",
      headers: { host: "mcp.agentlogin.test", origin: "https://dashboard.agentlogin.test" },
      payload: {}
    });
    expect(response.statusCode).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    await isolated.close();
  });

  it("rejects invalid agent credentials and does not create an MCP session", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 401 }));
    const isolated = createAgentLoginMcpApp({
      apiBaseUrl: "https://api.agentlogin.test",
      allowedHosts: ["mcp.agentlogin.test"],
      fetch: fetcher
    });
    const response = await isolated.inject({
      method: "POST", url: "/mcp",
      headers: { host: "mcp.agentlogin.test", authorization: "Bearer invalid-agent-token" },
      payload: {}
    });
    expect(response.statusCode).toBe(401);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer invalid-agent-token" });
    await isolated.close();
  });

  it("fails closed when the identity API is unavailable", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 500 }));
    const isolated = createAgentLoginMcpApp({
      apiBaseUrl: "https://api.agentlogin.test",
      allowedHosts: ["mcp.agentlogin.test"],
      fetch: fetcher
    });
    const response = await isolated.inject({
      method: "POST", url: "/mcp",
      headers: { host: "mcp.agentlogin.test", authorization: "Bearer agent-token" },
      payload: {}
    });
    expect(response.statusCode).toBe(503);
    await isolated.close();
  });

  it("rejects malformed Origin configuration at startup", () => {
    expect(() => createAgentLoginMcpApp({
      apiBaseUrl: "https://api.agentlogin.test",
      allowedHosts: ["mcp.agentlogin.test"],
      allowedOrigins: ["https://dashboard.agentlogin.test/path"]
    })).toThrow("exact origins");
  });
});
