import Fastify from "fastify";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRemoteJWKSet,
  customFetch,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import type { Database } from "@agentlogin/database";
import { userAuthenticationPlugin } from "./user-auth.js";

const ISSUER = "https://agentlogin-test.us.auth0.com/";
const AUDIENCE = "https://api.agentlogin.app";
const JWKS_URL = "https://agentlogin-test.us.auth0.com/.well-known/jwks.json";
const TENANT_CLAIM = "https://agentlogin.app/tenant_id";

describe("OIDC JWT verification against a JWKS", () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let jwks: JWTVerifyGetKey;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    const publicJwk = await exportJWK(pair.publicKey);
    const responseBody = JSON.stringify({
      keys: [{ ...publicJwk, kid: "agentlogin-auth0-test-key", use: "sig", alg: "RS256" }],
    });
    // Exercise jose's production remote-JWKS resolver while keeping the test
    // deterministic and offline; only the HTTPS response transport is stubbed.
    jwks = createRemoteJWKSet(new URL(JWKS_URL), {
      [customFetch]: async () => new Response(responseBody, {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
      }),
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  async function requestIdentity(options: {
    issuer?: string;
    audience?: string;
    expired?: boolean;
    includeTenant?: boolean;
  } = {}) {
    vi.stubEnv("OIDC_ISSUER_URL", ISSUER);
    vi.stubEnv("OIDC_AUDIENCE", AUDIENCE);
    vi.stubEnv("OIDC_JWKS_URL", JWKS_URL);
    vi.stubEnv("OIDC_TENANT_CLAIM", TENANT_CLAIM);
    vi.stubEnv("OIDC_MAX_TOKEN_AGE", "24h");

    const claims: Record<string, unknown> = {};
    if (options.includeTenant !== false) claims[TENANT_CLAIM] = "tenant-auth0-test";
    const now = Date.now();
    let token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "agentlogin-auth0-test-key", typ: "JWT" })
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? AUDIENCE)
      .setSubject("auth0|synthetic-user")
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(options.expired ? Math.floor(now / 1000) - 60 : Math.floor(now / 1000) + 300)
      .sign(privateKey);

    const app = Fastify({ logger: false });
    userAuthenticationPlugin(app, { database: {} as Database, jwks });
    app.get("/identity", { preHandler: app.authenticateIdentity }, async (request) => ({
      tenant_id: request.oidcIdentity?.tenantId,
      auth_subject: request.oidcIdentity?.authSubject,
    }));
    const response = await app.inject({
      method: "GET",
      url: "/identity",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    token = "";
    return response;
  }

  it("accepts a correctly signed RS256 token with the configured issuer, audience and tenant claim", async () => {
    const response = await requestIdentity();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      tenant_id: "tenant-auth0-test",
      auth_subject: "auth0|synthetic-user",
    });
  });

  it("rejects a token signed by an unknown JWKS key", async () => {
    const unknownKey = await generateKeyPair("RS256");
    const token = await new SignJWT({ [TENANT_CLAIM]: "tenant-auth0-test" })
      .setProtectedHeader({ alg: "RS256", kid: "not-in-jwks" })
      .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject("auth0|synthetic-user")
      .setIssuedAt().setExpirationTime("5m").sign(unknownKey.privateKey);

    vi.stubEnv("OIDC_ISSUER_URL", ISSUER);
    vi.stubEnv("OIDC_AUDIENCE", AUDIENCE);
    vi.stubEnv("OIDC_JWKS_URL", JWKS_URL);
    vi.stubEnv("OIDC_TENANT_CLAIM", TENANT_CLAIM);
    const app = Fastify({ logger: false });
    userAuthenticationPlugin(app, { database: {} as Database, jwks });
    app.get("/identity", { preHandler: app.authenticateIdentity }, async () => ({ authenticated: true }));
    const response = await app.inject({ method: "GET", url: "/identity", headers: { authorization: `Bearer ${token}` } });
    await app.close();
    expect(response.statusCode).toBe(401);
  });

  it("rejects the wrong issuer", async () => {
    expect((await requestIdentity({ issuer: "https://attacker.example/" })).statusCode).toBe(401);
  });

  it("rejects the wrong audience", async () => {
    expect((await requestIdentity({ audience: "https://other-api.example" })).statusCode).toBe(401);
  });

  it("rejects expired tokens", async () => {
    expect((await requestIdentity({ expired: true })).statusCode).toBe(401);
  });

  it("rejects tokens without the trusted tenant claim", async () => {
    expect((await requestIdentity({ includeTenant: false })).statusCode).toBe(401);
  });
});
