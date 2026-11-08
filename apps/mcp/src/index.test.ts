import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createAgentLoginMcpHandler } from "./index.js";

const authInfo = {
  token: "agent-token",
  clientId: "agt_123",
  scopes: ["agentlogin:agent"],
  expiresAt: Math.floor(Date.now() / 1000) + 60
};

describe("AgentLogin MCP server", () => {
  it("registers only the supported identity and access-request tools", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      authenticated: true,
      principal: { tenant_id: "ten_1", developer_id: "dev_1", agent_id: "agt_123", credential_id: "acred_1" }
    }), { status: 200 }));
    const handler = createAgentLoginMcpHandler({ apiBaseUrl: "https://api.agentlogin.test", fetch: fetcher });
    const transport = new StreamableHTTPClientTransport(new URL("https://mcp.agentlogin.test/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo })
    });
    const client = new Client({ name: "agentlogin-test", version: "1.0.0" });
    await client.connect(transport);
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "agentlogin_get_access_request",
      "agentlogin_get_identity",
      "agentlogin_request_access"
    ]);
    await client.close();
  });

  it("lets the owning agent check a grant status without exposing credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "approved",
      grant_id: "grt_12345678901234567890",
      origin: "https://example.com",
      scopes: ["autofill_login"],
      expires_at: "2026-11-08T20:00:00.000Z",
      approved_at: "2026-11-08T19:00:00.000Z"
    }), { status: 200 }));
    const handler = createAgentLoginMcpHandler({ apiBaseUrl: "https://api.agentlogin.test", fetch: fetcher });
    const transport = new StreamableHTTPClientTransport(new URL("https://mcp.agentlogin.test/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo })
    });
    const client = new Client({ name: "agentlogin-test", version: "1.0.0" });
    await client.connect(transport);
    const result = await client.callTool({
      name: "agentlogin_get_access_request",
      arguments: { grant_id: "grt_12345678901234567890" }
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "approved", grant_id: "grt_12345678901234567890" });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.agentlogin.test/v1/agent/grants/grt_12345678901234567890");
    await client.close();
  });

  it("uses the authenticated agent token to request a user-approved grant", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "pending_approval",
        grant_id: "grt_12345678901234567890",
        approval_id: "apr_123",
        expires_at: "2026-11-08T20:00:00.000Z"
      }), { status: 202 }));
    const handler = createAgentLoginMcpHandler({ apiBaseUrl: "https://api.agentlogin.test", fetch: fetcher });
    const transport = new StreamableHTTPClientTransport(new URL("https://mcp.agentlogin.test/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo })
    });
    const client = new Client({ name: "agentlogin-test", version: "1.0.0" });
    await client.connect(transport);
    const result = await client.callTool({
      name: "agentlogin_request_access",
      arguments: {
        user_id: "usr_123",
        account_id: "acc_123",
        origin: "https://example.com",
        scopes: ["autofill_login"]
      }
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "pending_approval", grant_id: "grt_12345678901234567890" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBeInstanceOf(URL);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://api.agentlogin.test/v1/users/usr_123/grants");
    expect((fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe("Bearer agent-token");
    await client.close();
  });
});
