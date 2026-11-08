import { describe, expect, it, vi } from "vitest";
import {
  AgentLoginAuthenticationError,
  AgentLoginClient,
  AgentLoginPermissionError,
  AgentLoginValidationError
} from "./index.js";

const identity = {
  authenticated: true,
  principal: { tenant_id: "ten_1", developer_id: "dev_1", agent_id: "agt_1", credential_id: "acred_1" }
};

describe("AgentLoginClient", () => {
  it("retrieves the authenticated agent identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(identity), { status: 200 }));
    const client = new AgentLoginClient({ baseUrl: "https://api.agentlogin.test", agentToken: "opaque-agent-token", fetch: fetcher });
    await expect(client.getAgentIdentity()).resolves.toEqual(identity);
    expect(fetcher).toHaveBeenCalledWith(new URL("https://api.agentlogin.test/v1/agent/me"), expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ authorization: "Bearer opaque-agent-token" })
    }));
  });

  it("uses the implemented user-scoped grant route and never retries a mutation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "pending_approval", grant_id: "grt_12345678901234567890", approval_id: "apr_123", expires_at: "2026-11-08T20:00:00.000Z"
    }), { status: 202 }));
    const client = new AgentLoginClient({ baseUrl: "https://api.agentlogin.test/", agentToken: "agent-token", fetch: fetcher, maxRetries: 3 });
    await client.requestGrant("usr_123", {
      account_id: "acc_123", origin: "https://example.com", scopes: ["autofill_login"]
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.agentlogin.test/v1/users/usr_123/grants");
  });

  it("uses a token provider for rotating credentials", async () => {
    const provider = vi.fn().mockResolvedValue("rotated-token");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(identity), { status: 200 }));
    const client = new AgentLoginClient({ baseUrl: "https://api.agentlogin.test", tokenProvider: provider, fetch: fetcher });
    await client.getAgentIdentity();
    expect(provider).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(expect.objectContaining({ authorization: "Bearer rotated-token" }));
  });

  it.each([
    [401, AgentLoginAuthenticationError],
    [403, AgentLoginPermissionError],
    [422, AgentLoginValidationError]
  ])("maps HTTP %s to a typed error", async (status, ErrorType) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "test_error", message: "Safe failure" }
    }), { status }));
    const client = new AgentLoginClient({ baseUrl: "https://api.agentlogin.test", agentToken: "agent-token", fetch: fetcher, maxRetries: 0 });
    await expect(client.getAgentIdentity()).rejects.toBeInstanceOf(ErrorType);
  });

  it("rejects ambiguous credential configuration", () => {
    expect(() => new AgentLoginClient({
      baseUrl: "https://api.agentlogin.test", agentToken: "one", tokenProvider: () => "two"
    })).toThrow("not both");
  });
});
