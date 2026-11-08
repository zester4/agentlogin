import { createPublicKey, verify as verifySignature } from "node:crypto";

type RsaJwk = JsonWebKey & {
  kid?: string;
  use?: string;
  alg?: string;
  key_ops?: string[];
  d?: string;
};

export type VerifiedUserToken = {
  tenantId: string;
  issuer: string;
  subject: string;
  expiresAt: Date;
};

export interface UserTokenVerifier {
  readonly issuer: string;
  verify(token: string): VerifiedUserToken;
}

export class InvalidUserTokenError extends Error {
  constructor() {
    super("Invalid user token");
    this.name = "InvalidUserTokenError";
  }
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new InvalidUserTokenError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new InvalidUserTokenError();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new InvalidUserTokenError();
  return parsed as Record<string, unknown>;
}

export class StaticJwksUserTokenVerifier implements UserTokenVerifier {
  readonly issuer: string;
  private readonly audience: string;
  private readonly keys: Map<string, RsaJwk>;

  constructor(options: { issuer: string; audience: string; jwksJson: string }) {
    this.issuer = options.issuer;
    this.audience = options.audience;
    const jwks: unknown = JSON.parse(options.jwksJson);
    if (typeof jwks !== "object" || jwks === null || !("keys" in jwks) || !Array.isArray((jwks as { keys: unknown }).keys)) {
      throw new Error("OIDC_JWKS_JSON must contain a keys array");
    }
    this.keys = new Map();
    for (const value of (jwks as { keys: unknown[] }).keys) {
      if (typeof value !== "object" || value === null) continue;
      const key = value as RsaJwk;
      if (typeof key.kid !== "string" || key.kty !== "RSA" || typeof key.n !== "string" || typeof key.e !== "string") continue;
      if (key.d !== undefined || Buffer.from(key.n, "base64url").length < 256) continue;
      if ((key.use !== undefined && key.use !== "sig") || (key.alg !== undefined && key.alg !== "RS256")) continue;
      if (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes("verify"))) continue;
      if (this.keys.has(key.kid)) throw new Error("OIDC JWKS contains duplicate key IDs");
      this.keys.set(key.kid, key);
    }
    if (this.keys.size === 0) throw new Error("OIDC JWKS has no usable RSA signing keys");
  }

  verify(token: string): VerifiedUserToken {
    if (token.length > 16_384) throw new InvalidUserTokenError();
    const parts = token.split(".");
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2]!)) throw new InvalidUserTokenError();
    const header = decodeJsonSegment(parts[0]!);
    const claims = decodeJsonSegment(parts[1]!);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || header.crit !== undefined || header.b64 === false) {
      throw new InvalidUserTokenError();
    }
    const jwk = this.keys.get(header.kid);
    if (!jwk) throw new InvalidUserTokenError();

    let valid = false;
    try {
      const publicKey = createPublicKey({ key: jwk, format: "jwk" });
      valid = verifySignature(
        "RSA-SHA256",
        Buffer.from(parts[0] + "." + parts[1], "utf8"),
        publicKey,
        Buffer.from(parts[2]!, "base64url")
      );
    } catch {
      throw new InvalidUserTokenError();
    }
    if (!valid) throw new InvalidUserTokenError();

    const now = Math.floor(Date.now() / 1000);
    const audience = claims.aud;
    const audienceMatches = audience === this.audience || (Array.isArray(audience) && audience.includes(this.audience));
    const validNbf = claims.nbf === undefined || (typeof claims.nbf === "number" && Number.isFinite(claims.nbf) && claims.nbf <= now);
    if (
      claims.iss !== this.issuer ||
      !audienceMatches ||
      typeof claims.sub !== "string" ||
      claims.sub.length === 0 ||
      claims.sub.length > 255 ||
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now ||
      typeof claims.iat !== "number" ||
      !Number.isFinite(claims.iat) ||
      claims.iat > now + 60 ||
      claims.iat >= claims.exp ||
      !validNbf ||
      typeof claims.tenant_id !== "string" ||
      !/^ten_[0-9a-f-]{36}$/.test(claims.tenant_id)
    ) {
      throw new InvalidUserTokenError();
    }

    return {
      tenantId: claims.tenant_id,
      issuer: this.issuer,
      subject: claims.sub,
      expiresAt: new Date(claims.exp * 1000)
    };
  }
}
