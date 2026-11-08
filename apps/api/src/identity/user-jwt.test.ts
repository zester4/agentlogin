import { generateKeyPairSync, sign as signJwt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidUserTokenError, StaticJwksUserTokenVerifier } from "./user-jwt.js";

const issuer = "https://identity.example.test";
const audience = "agentlogin-api";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });
const verifier = new StaticJwksUserTokenVerifier({
  issuer,
  audience,
  jwksJson: JSON.stringify({ keys: [{ ...publicJwk, kid: "test-key", use: "sig", alg: "RS256" }] })
});

function token(claims: Record<string, unknown>, key = privateKey): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = header + "." + payload;
  return input + "." + signJwt("RSA-SHA256", Buffer.from(input), key).toString("base64url");
}

function validClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    aud: audience,
    sub: "user-subject-1",
    tenant_id: "ten_00000000-0000-4000-8000-000000000001",
    iat: now,
    exp: now + 300,
    ...overrides
  };
}

describe("static OIDC user token verifier", () => {
  it("verifies an RS256 token and returns only the verified identity tuple", () => {
    const result = verifier.verify(token(validClaims()));
    expect(result.tenantId).toBe("ten_00000000-0000-4000-8000-000000000001");
    expect(result.issuer).toBe(issuer);
    expect(result.subject).toBe("user-subject-1");
  });

  it.each([
    { aud: "another-api" },
    { iss: "https://attacker.example.test" },
    { tenant_id: "ten_attacker" },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { sub: "" }
  ])("rejects invalid or unbound claims", (override) => {
    expect(() => verifier.verify(token(validClaims(override)))).toThrow(InvalidUserTokenError);
  });

  it("rejects a token signed by an untrusted key", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => verifier.verify(token(validClaims(), other.privateKey))).toThrow(InvalidUserTokenError);
  });

  it("rejects algorithms other than RS256", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", kid: "test-key" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(validClaims())).toString("base64url");
    expect(() => verifier.verify(header + "." + payload + ".")).toThrow(InvalidUserTokenError);
  });
});
