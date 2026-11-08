import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { vaultLifecycleDiagnosticRoutes } from "./vault-lifecycle-diagnostic.js";

const originalToken = process.env.VAULT_LIFECYCLE_DIAGNOSTIC_TOKEN;
afterEach(() => {
  if (originalToken === undefined) delete process.env.VAULT_LIFECYCLE_DIAGNOSTIC_TOKEN;
  else process.env.VAULT_LIFECYCLE_DIAGNOSTIC_TOKEN = originalToken;
});

describe("protected vault lifecycle diagnostic", () => {
  it("is not exposed unless a high-entropy diagnostic token is configured", async () => {
    delete process.env.VAULT_LIFECYCLE_DIAGNOSTIC_TOKEN;
    const app = Fastify();
    await app.register(vaultLifecycleDiagnosticRoutes, {});
    const response = await app.inject({ method: "POST", url: "/internal/vault/lifecycle-self-test" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("requires the exact bearer token and returns no diagnostic data to unauthenticated callers", async () => {
    process.env.VAULT_LIFECYCLE_DIAGNOSTIC_TOKEN = "v".repeat(48);
    const app = Fastify();
    await app.register(vaultLifecycleDiagnosticRoutes, {});
    const response = await app.inject({
      method: "POST",
      url: "/internal/vault/lifecycle-self-test",
      headers: { authorization: "Bearer incorrect-token" }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "unauthorized" } });
    await app.close();
  });
});
