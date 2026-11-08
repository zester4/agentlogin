import { createAgentLoginMcpApp } from "./app.js";

const apiBaseUrl = process.env.AGENTLOGIN_API_URL;
if (!apiBaseUrl) throw new Error("AGENTLOGIN_API_URL is required.");

const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? (process.env.NODE_ENV === "production" ? "" : "localhost,127.0.0.1"))
  .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);

const app = createAgentLoginMcpApp({ apiBaseUrl, allowedHosts, allowedOrigins });
const port = Number(process.env.PORT ?? process.env.MCP_PORT ?? 4010);
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
