import { describe, expect, it } from "vitest";
import { assertSafeWebhookPayload } from "./webhook-repository.js";

describe("assertSafeWebhookPayload", () => {
  it("accepts minimal non-sensitive event data", () => {
    expect(() => assertSafeWebhookPayload({
      resource: { id: "grant_123", type: "grant" },
      status: "revoked",
      scopes: ["calendar.read"],
    })).not.toThrow();
  });

  it("accepts the credentials-revoked lifecycle flag only as a boolean", () => {
    expect(() => assertSafeWebhookPayload({ credentials_revoked: true })).not.toThrow();
    expect(() => assertSafeWebhookPayload({ credentials_revoked: "yes" })).toThrow(/prohibited field/i);
  });

  it.each([
    { token: "do-not-send" },
    { nested: { accessToken: "do-not-send" } },
    { credential: { id: "cred_123" } },
    { browser_state: "private" },
    { providerResponse: { value: "secret-bearing" } },
  ])("rejects prohibited fields: %j", (payload) => {
    expect(() => assertSafeWebhookPayload(payload)).toThrow(/prohibited field/i);
  });

  it("rejects unsupported values and oversized strings", () => {
    expect(() => assertSafeWebhookPayload({ value: undefined })).toThrow(/unsupported value/i);
    expect(() => assertSafeWebhookPayload({ value: "x".repeat(2049) })).toThrow(/oversized/i);
  });
});
