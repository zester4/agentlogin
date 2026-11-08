import { createAgentLoginMcpHandler } from "./index.js";
import { createMcpFastifyApp } from "@modelcontextprotocol/fastify";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { AgentIdentitySchema } from "@agentlogin/contracts";

const apiBaseUrl = process.env.AGENTLOGIN_API_URL;
if (!apiBaseUrl) throw new Error("AGENTLOGIN_API_URL is required.");

const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? (process.env.NODE_ENV === "production" ? "" : "localhost,127.0.0.1"))
  .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);

if (allowedHosts.length === 0) throw new Error("MCP_ALLOWED_HOSTS must contain the public MCP hostname(s).");

const app = createMcpFastifyApp({
  host: process.env.HOST ?? "0.0.0.0",
  allowedHosts,
  allowedOrigins: allowedOrigins.map((origin) => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) throw new Error(`MCP_ALLOWED_ORIGINS entries must be exact origins: ${origin}`);
    return parsed.hostname;
  })
});
const handler = createAgentLoginMcpHandler({ apiBaseUrl });
const nodeHandler = toNodeHandler(handler);

app.get("/health", async () => ({ status: "ok", service: "agentlogin-mcp" }));

app.addHook("onRequest", async (request, reply) => {
  // createMcpFastifyApp enforces the Host allowlist; this hook tightens browser
  // Origin validation to exact scheme+host+port matches from configuration.
  const origin = request.headers.origin;
  if (origin) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch {
      await reply.code(403).send({ error: "forbidden_origin" });
      return;
    }
    if (allowedOrigins.length === 0 || !allowedOrigins.includes(parsed.origin)) {
      await reply.code(403).send({ error: "forbidden_origin" });
    }
  }
});

app.all("/mcp", async (request, reply) => {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ") || authorization.length > 5000) {
    return reply.code(401).send({ error: { code: "unauthorized", message: "AgentLogin agent authentication required." } });
  }
  const token = authorization.slice(7);
  try {
    const response = await fetch(new URL("/v1/agent/me", apiBaseUrl), {
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
    return nodeHandler(Object.assign(request.raw, { auth, method: request.method }), reply.raw, request.body);
  } catch {
    return reply.code(503).send({ error: { code: "identity_service_unavailable", message: "AgentLogin identity verification is unavailable." } });
  }
});

const port = Number(process.env.PORT ?? process.env.MCP_PORT ?? 4010);
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
