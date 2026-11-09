import { describe, expect, it } from "vitest";
import { createWorkerTicket, verifyWorkerTicket } from "./worker-ticket.js";

const key = Buffer.alloc(32, 7);
const now = new Date("2026-11-09T12:00:00.000Z");
const binding = { tenantId: "tenant_a", executionId: "execution_a", leaseId: "lease_a" };

describe("short-lived worker tickets", () => {
  it("signs and verifies an execution- and lease-bound ticket", () => {
    const token = createWorkerTicket(binding, key, { now, ttlSeconds: 30 });
    expect(verifyWorkerTicket(token, key, { now })).toMatchObject({
      ...binding, issuedAt: 1794225600, expiresAt: 1794225630
    });
  });

  it("rejects tampering and a different signing key", () => {
    const token = createWorkerTicket(binding, key, { now });
    const parts = token.split(".");
    const header = parts[0];
    const payload = parts[1];
    const sig = parts[2];
    expect(header).toBeDefined();
    expect(payload).toBeDefined();
    expect(sig).toBeDefined();
    if (!header || !payload || !sig) throw new Error("Expected a three-part signed ticket.");
    const alteredSignature = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(() => verifyWorkerTicket(header + "." + payload + "." + alteredSignature, key, { now })).toThrow();
    expect(() => verifyWorkerTicket(token, Buffer.alloc(32, 8), { now })).toThrow();
  });

  it("rejects expired, future-issued and overlong tickets", () => {
    const token = createWorkerTicket(binding, key, { now, ttlSeconds: 1 });
    expect(() => verifyWorkerTicket(token, key, { now: new Date(now.getTime() + 1000) })).toThrow();
    expect(() => createWorkerTicket(binding, key, { now, ttlSeconds: 61 })).toThrow();
    expect(() => createWorkerTicket(binding, Buffer.alloc(16), { now })).toThrow();
  });

  it("rejects malformed or incomplete identities", () => {
    expect(() => createWorkerTicket({ ...binding, tenantId: "" }, key, { now })).toThrow();
    expect(() => verifyWorkerTicket("not-a-jwt", key, { now })).toThrow();
  });
});
