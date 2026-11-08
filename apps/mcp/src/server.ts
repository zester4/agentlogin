import { createAgentLoginMcpApp } from "./app.js";

const apiBaseUrl = process.env.AGENTLOGIN_API_URL;
if (!apiBaseUrl) throw new Error("AGENTLOGIN_API_URL is required.");

const configuredHosts = (process.env.MCP_ALLOWED_HOSTS ?? (process.env.NODE_ENV === "production" ? "" : "localhost,127.0.0.1"))
  .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);

// Railway's health checker may address the container through its private/public
// service hostname rather than the public custom domain. Trust only the
// platform-provided hostnames for this service, plus loopback health probes.
const platformHosts = [
  process.env.RAILWAY_PUBLIC_DOMAIN,
  process.env.RAILWAY_PRIVATE_DOMAIN,
  "localhost",
  "127.0.0.1"
].map((value) => value?.trim().toLowerCase()).filter((value): value is string => Boolean(value));
const allowedHosts = [...new Set([...configuredHosts, ...platformHosts])];
const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);

const app = createAgentLoginMcpApp({ apiBaseUrl, allowedHosts, allowedOrigins });
const port = Number(process.env.PORT ?? process.env.MCP_PORT ?? 4010);
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
