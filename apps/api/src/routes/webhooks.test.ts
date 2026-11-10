import { describe, expect, it } from "vitest";
import { normalizeWebhookUrl } from "./webhooks.js";

describe("webhook endpoint URL validation", () => {
  it("normalizes credential-free HTTPS URLs", () => {
    expect(normalizeWebhookUrl("https://hooks.example.com/events")).toBe("https://hooks.example.com/events");
  });

  it.each([
    "http://hooks.example.com/events",
    "https://user:pass@hooks.example.com/events",
    "https://hooks.example.com:8443/events",
    "https://hooks.example.com/events#fragment",
    "https://localhost/events",
    "https://127.0.0.1/events",
  ])("rejects unsafe or unsupported destination %s", (url) => {
    expect(() => normalizeWebhookUrl(url)).toThrow();
  });
});
