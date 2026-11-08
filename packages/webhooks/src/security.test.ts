import { describe, expect, it } from "vitest";
import { postWebhookSafely, signWebhookBody, verifyWebhookSignature } from "./index.js";

describe("webhook security primitives", () => {
  it("signs the exact body bytes and verifies the signature", () => {
    const secret = Buffer.alloc(32, 7);
    const body = Buffer.from("{\"event\":\"credential.created\"}");
    const signature = signWebhookBody(secret, 1_800_000_000, body);
    expect(verifyWebhookSignature(secret, 1_800_000_000, body, signature)).toBe(true);
    expect(verifyWebhookSignature(secret, 1_800_000_000, Buffer.from(body.toString() + " "), signature)).toBe(false);
    expect(verifyWebhookSignature(secret, 1_800_000_001, body, signature)).toBe(false);
  });

  it("rejects insecure URLs and private literal addresses before connecting", async () => {
    const common = {
      body: Buffer.from("{}"),
      secret: Buffer.alloc(32, 9),
      eventId: "evt_test",
      deliveryId: "dlv_test"
    };
    await expect(postWebhookSafely({ ...common, url: "http://example.com/hook" })).rejects.toThrow();
    await expect(postWebhookSafely({ ...common, url: "https://user:pass@example.com/hook" })).rejects.toThrow();
    await expect(postWebhookSafely({ ...common, url: "https://example.com:8443/hook" })).rejects.toThrow();
    await expect(postWebhookSafely({ ...common, url: "https://127.0.0.1/hook" })).rejects.toThrow(/public IPv4/);
    await expect(postWebhookSafely({ ...common, url: "https://169.254.169.254/latest/meta-data" })).rejects.toThrow(/public IPv4/);
  });

  it("rejects weak signing keys and malformed signatures", () => {
    expect(() => signWebhookBody(Buffer.alloc(16), 1_800_000_000, Buffer.from("{}"))).toThrow();
    expect(verifyWebhookSignature(Buffer.alloc(32, 1), 1_800_000_000, Buffer.from("{}"), "bad")).toBe(false);
  });
});
