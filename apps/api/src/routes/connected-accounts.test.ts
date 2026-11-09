import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { connectedAccountRoutes, isCredentialEnrollmentEnabled } from "./connected-accounts.js";

afterEach(() => {
  delete process.env.CREDENTIAL_ENROLLMENT_ENABLED;
});

describe("credential enrollment release gate", () => {
  it("fails closed when the environment variable is missing", () => {
    expect(isCredentialEnrollmentEnabled(undefined)).toBe(false);
  });

  it("requires the exact string true", () => {
    expect(isCredentialEnrollmentEnabled("true")).toBe(true);
    expect(isCredentialEnrollmentEnabled("TRUE")).toBe(false);
    expect(isCredentialEnrollmentEnabled("1")).toBe(false);
    expect(isCredentialEnrollmentEnabled("yes")).toBe(false);
    expect(isCredentialEnrollmentEnabled("false")).toBe(false);
    expect(isCredentialEnrollmentEnabled("")).toBe(false);
  });

  it("rejects account creation before validating or processing credentials when locked", async () => {
    delete process.env.CREDENTIAL_ENROLLMENT_ENABLED;
    const app = Fastify({ logger: false });
    app.decorate("authenticateUser", async (request) => {
      request.userPrincipal = { tenantId: "tenant_test", userId: "user_test" } as never;
    });
    await connectedAccountRoutes(app, { database: {} as never });
    const response = await app.inject({
      method: "POST",
      url: "/v1/connected-accounts",
      payload: { provider: "example", origin: "https://example.com", display_label: "Example", username: "synthetic", password: "synthetic-only" }
    });
    expect(response.statusCode).toBe(423);
    expect(response.json().error.code).toBe("credential_enrollment_locked");
    await app.close();
  });

  it("rejects credential rotation before loading or changing the credential when locked", async () => {
    delete process.env.CREDENTIAL_ENROLLMENT_ENABLED;
    const app = Fastify({ logger: false });
    app.decorate("authenticateUser", async (request) => {
      request.userPrincipal = { tenantId: "tenant_test", userId: "user_test" } as never;
    });
    await connectedAccountRoutes(app, { database: {} as never });
    const response = await app.inject({
      method: "POST",
      url: "/v1/connected-accounts/account_test/credentials/rotate",
      payload: { username: "synthetic", password: "synthetic-only" }
    });
    expect(response.statusCode).toBe(423);
    expect(response.json().error.code).toBe("credential_enrollment_locked");
    await app.close();
  });
});
