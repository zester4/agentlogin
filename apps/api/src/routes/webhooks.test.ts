import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { webhookEndpointRoutes, normalizeWebhookUrl, webhookSigningSecretContext } from "./webhooks.js";

afterEach(() => {
  delete process.env.WEBHOOK_ENDPOINTS_ENABLED;
});

describe("webhook endpoint management gate", () => {
  it("fails closed unless the exact string true is configured", async () => {
    delete process.env.WEBHOOK_ENDPOINTS_ENABLED;
    const app = Fastify({ logger: false });
    app.decorate("authenticateUser", async (request) => {
      request.userPrincipal = { tenantId: "tenant_test", userId: "user_test" } as never;
    });
    await webhookEndpointRoutes(app, { database: {} as never });
    const response = await app.inject({
      method: "POST",
      url: "/v1/developers/dev_test/webhook-endpoints",
      payload: { url: "https://hooks.example.com/events", event_types: ["grant.approved"] },
    });
    expect(response.statusCode).toBe(423);
    expect(response.json().error.code).toBe("webhook_endpoint_management_locked");
    await app.close();
  });

  it("requires an HTTPS hostname and rejects local or literal-IP destinations", () => {
    expect(normalizeWebhookUrl("https://hooks.example.com/events")).toBe("https://hooks.example.com/events");
    for (const url of [
      "http://hooks.example.com/events",
      "https://user:pass@hooks.example.com/events",
      "https://hooks.example.com:8443/events",
      "https://hooks.example.com/events#fragment",
      "https://localhost/events",
      "https://service.local/events",
      "https://127.0.0.1/events",
      "https://[::1]/events",
    ]) {
      expect(() => normalizeWebhookUrl(url)).toThrow();
    }
  });
});

describe("webhook signing-secret encryption context", () => {
  it("matches the endpoint-scoped KMS context used by the delivery worker", () => {
    expect(webhookSigningSecretContext("tenant_test", "whend_test", 2)).toEqual({
      tenantId: "tenant_test",
      accountId: "whend_test",
      credentialId: "whend_test",
      recordVersion: 2,
      purpose: "webhook_signing_secret",
    });
  });
});
