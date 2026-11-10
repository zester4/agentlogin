import { describe, expect, it, vi } from "vitest";
import {
  AgentLoginAuthenticationError,
  AgentLoginApplicationClient,
  AgentLoginClient,
  AgentLoginDeveloperClient,
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

  it("retrieves the authenticated agent's grant status", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "pending_approval",
      grant_id: "grt_12345678901234567890",
      origin: "https://example.com",
      scopes: ["autofill_login"],
      expires_at: "2026-11-08T20:00:00.000Z",
      approved_at: null
    }), { status: 200 }));
    const client = new AgentLoginClient({ baseUrl: "https://api.agentlogin.test", agentToken: "agent-token", fetch: fetcher });
    const grant = await client.getGrantStatus("grt_12345678901234567890");
    expect(grant.status).toBe("pending_approval");
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.agentlogin.test/v1/agent/grants/grt_12345678901234567890");
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


describe("AgentLoginApplicationClient", () => {
  it("exchanges client credentials and registers an agent without sending the secret in the body", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "al_app_test", token_type: "Bearer", expires_in: 900, scope: "agents:manage"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        agent_id: "agt_new",
        credential: { token: "al_agent_once", expires_at: "2026-11-10T00:00:00.000Z", display_once: true }
      }), { status: 201 }));
    const client = new AgentLoginApplicationClient({
      baseUrl: "https://api.agentlogin.test",
      clientId: "al_client_test",
      clientSecret: "al_secret_private",
      fetch: fetcher
    });
    const result = await client.registerAgent({ name: "Support agent", identity_type: "browser" });
    expect(result.agent_id).toBe("agt_new");
    expect(result.credential.token).toBe("al_agent_once");
    const tokenCall = fetcher.mock.calls[0]!;
    expect(String(tokenCall[0])).toBe("https://api.agentlogin.test/oauth/token");
    expect(tokenCall[1]?.headers).toEqual(expect.objectContaining({
      Authorization: `Basic ${Buffer.from("al_client_test:al_secret_private").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    }));
    expect(String(tokenCall[1]?.body)).toBe("grant_type=client_credentials");
    const registrationCall = fetcher.mock.calls[1]!;
    expect(String(registrationCall[0])).toBe("https://api.agentlogin.test/v1/app/agents");
    expect(registrationCall[1]?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer al_app_test" }));
    expect(String(registrationCall[1]?.body)).not.toContain("al_secret_private");
  });

  it("caches a short-lived application token across agent registrations", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "al_app_cached", token_type: "Bearer", expires_in: 900 }), { status: 200 }))
      .mockImplementation(async () => new Response(JSON.stringify({
        agent_id: "agt_new", credential: { token: "al_agent_once", expires_at: "2026-11-10T00:00:00.000Z", display_once: true }
      }), { status: 201 }));
    const client = new AgentLoginApplicationClient({ baseUrl: "https://api.agentlogin.test", clientId: "al_client_x", clientSecret: "al_secret_y", fetch: fetcher });
    await client.registerAgent({ name: "One", identity_type: "browser" });
    await client.registerAgent({ name: "Two", identity_type: "browser" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("requires HTTPS outside localhost", () => {
    expect(() => new AgentLoginApplicationClient({
      baseUrl: "http://api.agentlogin.test", clientId: "al_client_x", clientSecret: "al_secret_y"
    })).toThrow("HTTPS is required");
  });
});

describe("AgentLoginDeveloperClient", () => {
  it("creates an endpoint with a one-time signing secret using the OIDC user token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      endpoint_id: "whend_test",
      url: "https://hooks.example.com/events",
      event_types: ["grant.approved"],
      status: "active",
      signing_secret: "one-time-secret",
      secret_version: 1,
      warning: "Store this signing secret now. It will not be shown again."
    }), { status: 201 }));
    const client = new AgentLoginDeveloperClient({
      baseUrl: "https://api.agentlogin.test",
      accessTokenProvider: async () => "oidc-user-access-token",
      fetch: fetcher
    });
    const created = await client.createWebhookEndpoint("dev_123", {
      url: "https://hooks.example.com/events",
      event_types: ["grant.approved"]
    });
    expect(created.signing_secret).toBe("one-time-secret");
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://api.agentlogin.test/v1/developers/dev_123/webhook-endpoints"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer oidc-user-access-token" })
      })
    );
  });

  it("reads delivery history and never requests a response body containing endpoint secrets", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      deliveries: [{
        delivery_id: "whdel_1", endpoint_id: "whend_1", endpoint_url: "https://hooks.example.com",
        event_id: "whev_1", event_type: "grant.approved", resource_type: "grant", resource_id: "grt_1",
        status: "delivered", attempt_count: 1, next_attempt_at: null, delivered_at: "2026-11-10T00:00:00.000Z",
        dead_lettered_at: null, created_at: "2026-11-10T00:00:00.000Z"
      }]
    }), { status: 200 }));
    const client = new AgentLoginDeveloperClient({
      baseUrl: "https://api.agentlogin.test",
      accessTokenProvider: () => "oidc-user-token",
      fetch: fetcher
    });
    const rows = await client.listWebhookDeliveries("dev_123", { status: "delivered", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("status=delivered");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("limit=10");
  });

  it("requires HTTPS for non-local developer API URLs", () => {
    expect(() => new AgentLoginDeveloperClient({
      baseUrl: "http://api.agentlogin.test",
      accessTokenProvider: () => "token"
    })).toThrow("HTTPS is required");
  });
});
