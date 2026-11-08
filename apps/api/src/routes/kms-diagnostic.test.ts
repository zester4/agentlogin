import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { CredentialContext, KeyManagementProvider } from "@agentlogin/vault";

const original = {
  token: process.env.KMS_DIAGNOSTIC_TOKEN,
  keyId: process.env.AWS_KMS_KEY_ID,
  region: process.env.AWS_REGION
};
afterEach(() => {
  if (original.token === undefined) delete process.env.KMS_DIAGNOSTIC_TOKEN;
  else process.env.KMS_DIAGNOSTIC_TOKEN = original.token;
  if (original.keyId === undefined) delete process.env.AWS_KMS_KEY_ID;
  else process.env.AWS_KMS_KEY_ID = original.keyId;
  if (original.region === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = original.region;
});

describe("protected KMS diagnostic", () => {
  it("is not exposed unless a high-entropy diagnostic token is configured", async () => {
    delete process.env.KMS_DIAGNOSTIC_TOKEN;
    const app = buildApp();
    const response = await app.inject({ method: "POST", url: "/internal/kms/self-test" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("requires the exact bearer token", async () => {
    process.env.KMS_DIAGNOSTIC_TOKEN = "x".repeat(48);
    const app = buildApp();
    const response = await app.inject({
      method: "POST", url: "/internal/kms/self-test",
      headers: { authorization: "Bearer wrong-token" }
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("checks wrap, unwrap and rejects a changed encryption context without returning key material", async () => {
    process.env.KMS_DIAGNOSTIC_TOKEN = "t".repeat(48);
    process.env.AWS_KMS_KEY_ID = "arn:aws:kms:us-east-1:123456789012:key/test";
    process.env.AWS_REGION = "us-east-1";
    let expectedContext: CredentialContext | undefined;
    const fake: KeyManagementProvider = {
      wrapKey: vi.fn(async (dek, context) => {
        expectedContext = context;
        return { wrappedDek: new Uint8Array(dek), keyVersion: "synthetic-key-version" };
      }),
      unwrapKey: vi.fn(async (wrapped, _version, context) => {
        if (JSON.stringify(context) !== JSON.stringify(expectedContext)) throw new Error("context mismatch");
        return new Uint8Array(wrapped);
      })
    };
    const { kmsDiagnosticRoutes } = await import("./kms-diagnostic.js");
    const app = (await import("fastify")).default();
    await app.register(kmsDiagnosticRoutes, { provider: fake });
    const response = await app.inject({
      method: "POST", url: "/internal/kms/self-test",
      headers: { authorization: "Bearer " + process.env.KMS_DIAGNOSTIC_TOKEN }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "passed",
      checks: { kms_encrypt: true, kms_decrypt: true, encryption_context_rejection: true }
    });
    expect(response.body).not.toContain("wrapped");
    expect(response.body).not.toContain("synthetic-key-version");
    await app.close();
  });
});
