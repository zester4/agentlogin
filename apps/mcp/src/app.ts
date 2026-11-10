import { createAgentLoginMcpHandler } from "./index.js";
import { createMcpFastifyApp } from "@modelcontextprotocol/fastify";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { AgentIdentitySchema } from "@agent-login/contracts";

export type AgentLoginMcpAppOptions = {
  apiBaseUrl: string;
  allowedHosts: string[];
  allowedOrigins?: string[];
  fetch?: typeof fetch;
};

export function createAgentLoginMcpApp(options: AgentLoginMcpAppOptions) {
  const apiBaseUrl = new URL(options.apiBaseUrl);
  if (!["https:", "http:"].includes(apiBaseUrl.protocol) || apiBaseUrl.username || apiBaseUrl.password) {
    throw new TypeError("apiBaseUrl must be an HTTP(S) URL.");
  }
  const allowedHosts = options.allowedHosts.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (allowedHosts.length === 0) throw new Error("MCP_ALLOWED_HOSTS must contain the public MCP hostname(s).");
  const allowedOrigins = options.allowedOrigins ?? [];
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) throw new Error(`MCP_ALLOWED_ORIGINS entries must be exact origins: ${origin}`);
  }

  const fetcher = options.fetch ?? fetch;
  // Railway's health checker can use an internal Host header that is not the
  // public service hostname. Keep the health endpoint reachable by the platform,
  // while enforcing the explicit hostname allowlist on the MCP protocol route.
  // The MCP SDK's global Host hook cannot express a health-route exception.
  const app = createMcpFastifyApp({ host: "0.0.0.0" });
  const handler = createAgentLoginMcpHandler({ apiBaseUrl: apiBaseUrl.toString(), fetch: fetcher });
  const nodeHandler = toNodeHandler(handler);

  app.get("/health", async () => ({ status: "ok", service: "agentlogin-mcp" }));

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.split("?")[0] === "/mcp") {
      const hostHeader = request.headers.host;
      let hostname: string;
      try {
        if (!hostHeader) throw new TypeError("Missing Host header");
        hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
      } catch {
        await reply.code(403).send({ error: "forbidden_host" });
        return;
      }
      if (!allowedHosts.includes(hostname)) {
        await reply.code(403).send({ error: "forbidden_host" });
        return;
      }
    }

    const origin = request.headers.origin;
    if (!origin) return;
    let parsed: URL;
    try { parsed = new URL(origin); } catch {
      await reply.code(403).send({ error: "forbidden_origin" });
      return;
    }
    if (allowedOrigins.length === 0 || !allowedOrigins.includes(parsed.origin)) {
      await reply.code(403).send({ error: "forbidden_origin" });
    }
  });

  app.all("/mcp", async (request, reply) => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ") || authorization.length > 5000) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "AgentLogin agent authentication required." } });
    }
    const token = authorization.slice(7);
    try {
      const response = await fetcher(new URL("/v1/agent/me", apiBaseUrl), {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: AbortSignal.timeout(8_000)
      });
      if (response.status === 401 || response.status === 403) {
        return reply.code(401).send({ error: { code: "unauthorized", message: "AgentLogin agent authentication failed." } });
      }
      if (!response.ok) {
        return reply.code(503).send({ error: { code: "identity_service_unavailable", message: "AgentLogin identity verification is unavailable." } });
      }
      const identity = AgentIdentitySchema.parse(await response.json());
      const auth: AuthInfo = {
        token,
        clientId: identity.principal.agent_id,
        scopes: ["agentlogin:agent"],
        expiresAt: Math.floor(Date.now() / 1000) + 30
      };
      return nodeHandler(Object.assign(request.raw, { auth, method: request.method, url: request.url }), reply.raw, request.body);
    } catch {
      return reply.code(503).send({ error: { code: "identity_service_unavailable", message: "AgentLogin identity verification is unavailable." } });
    }
  });

  return app;
}
