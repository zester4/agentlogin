import { describe, expect, it } from "vitest";
import { signWebhookBody, verifyWebhookSignature } from "./index.js";

describe("webhook security primitives", () => {
  it("signs the exact body bytes and verifies the signature", () => {
    const secret = Buffer.alloc(32, 7);
    const body = Buffer.from("{\"event\":\"credential.created\"}");
    const signature = signWebhookBody(secret, 1_800_000_000, body);
    expect(verifyWebhookSignature(secret, 1_800_000_000, body, signature)).toBe(true);
    expect(verifyWebhookSignature(secret, 1_800_000_000, Buffer.from(body.toString() + " "), signature)).toBe(false);
    expect(verifyWebhookSignature(secret, 1_800_000_001, body, signature)).toBe(false);
  });

  it("rejects weak signing keys and malformed signatures", () => {
    expect(() => signWebhookBody(Buffer.alloc(16), 1_800_000_000, Buffer.from("{}"))).toThrow();
    expect(verifyWebhookSignature(Buffer.alloc(32, 1), 1_800_000_000, Buffer.from("{}"), "bad")).toBe(false);
  });
});
