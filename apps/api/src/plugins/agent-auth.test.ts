import { describe, expect, it } from "vitest";
import type { Database } from "@agentlogin/database";
import { buildApp } from "../app.js";
import { decodeAgentSigningKey } from "./agent-auth.js";

describe("agent authentication boundary", () => {
  it("accepts only canonical 256-bit base64url signing keys", () => {
    const key = Buffer.alloc(32, 19).toString("base64url");
    expect(decodeAgentSigningKey(key)).toHaveLength(32);
    expect(decodeAgentSigningKey(undefined)).toBeNull();
    expect(decodeAgentSigningKey("short")).toBeNull();
    expect(decodeAgentSigningKey(Buffer.alloc(31).toString("base64url"))).toBeNull();
    expect(decodeAgentSigningKey(key + "=")).toBeNull();
  });

  it("returns 503 when agent auth is not configured", async () => {
    const app = buildApp(undefined, { database: {} as Database, signingKey: null });
    const response = await app.inject({ method: "GET", url: "/v1/agent/me", headers: { authorization: "Bearer al_agent_invalid" } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "agent_auth_unavailable", message: "Agent authentication is not configured." } });
    await app.close();
  });

  it("rejects missing credentials without database access", async () => {
    const app = buildApp(undefined, { database: {} as Database, signingKey: Buffer.alloc(32, 1) });
    const response = await app.inject({ method: "GET", url: "/v1/agent/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("unauthorized");
    await app.close();
  });

  it("rejects malformed credentials without database access", async () => {
    const app = buildApp(undefined, { database: {} as Database, signingKey: Buffer.alloc(32, 1) });
    const response = await app.inject({ method: "GET", url: "/v1/agent/me", headers: { authorization: "Bearer invalid" } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("unauthorized");
    await app.close();
  });
});
