import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@agentlogin/database";
import { buildApp } from "../app.js";

afterEach(() => vi.unstubAllEnvs());

describe("OIDC user authentication", () => {
  it("fails closed when issuer, audience, or JWKS configuration is absent", async () => {
    vi.stubEnv("OIDC_ISSUER_URL", "");
    vi.stubEnv("OIDC_AUDIENCE", "");
    vi.stubEnv("OIDC_JWKS_URL", "");
    const app = buildApp(undefined, { database: {} as Database, signingKey: null });
    const response = await app.inject({ method: "GET", url: "/v1/user/me", headers: { authorization: "Bearer placeholder" } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("user_auth_unavailable");
    await app.close();
  });

  it("does not allow onboarding to bypass OIDC verification", async () => {
    vi.stubEnv("OIDC_ISSUER_URL", "");
    vi.stubEnv("OIDC_AUDIENCE", "");
    vi.stubEnv("OIDC_JWKS_URL", "");
    const app = buildApp(undefined, { database: {} as Database, signingKey: null });
    const response = await app.inject({ method: "POST", url: "/v1/onboarding", payload: { tenant_name: "Untrusted" } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("user_auth_unavailable");
    await app.close();
  });
});
