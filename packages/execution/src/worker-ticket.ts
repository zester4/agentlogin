import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ISSUER = "agentlogin-api";
const AUDIENCE = "agentlogin-credential-broker";
const MAX_TTL_SECONDS = 60;

export type WorkerTicketClaims = {
  tenantId: string;
  executionId: string;
  leaseId: string;
  issuedAt: number;
  expiresAt: number;
  tokenId: string;
};

function assertKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.byteLength < 32) {
    throw new TypeError("Worker ticket signing key must contain at least 32 bytes.");
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signature(input: string, key: Uint8Array): Buffer {
  return createHmac("sha256", key).update(input, "utf8").digest();
}

/** Mint only inside the trusted API after issuing a credential lease. */
export function createWorkerTicket(
  input: { tenantId: string; executionId: string; leaseId: string },
  key: Uint8Array,
  options: { now?: Date; ttlSeconds?: number } = {}
): string {
  assertKey(key);
  if (!input.tenantId || !input.executionId || !input.leaseId) {
    throw new TypeError("Worker ticket identity claims are required.");
  }
  const now = options.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const ttl = options.ttlSeconds ?? MAX_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
    throw new TypeError("Worker ticket lifetime must be between 1 and 60 seconds.");
  }
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: ISSUER, aud: AUDIENCE, sub: input.executionId,
    tenant_id: input.tenantId, execution_id: input.executionId,
    lease_id: input.leaseId, iat: nowSeconds, exp: nowSeconds + ttl,
    jti: randomBytes(18).toString("base64url")
  });
  const signingInput = header + "." + payload;
  return signingInput + "." + signature(signingInput, key).toString("base64url");
}

/** Verify signature, fixed algorithm/audience/issuer, expiry and required bindings. */
export function verifyWorkerTicket(
  token: string,
  key: Uint8Array,
  options: { now?: Date } = {}
): WorkerTicketClaims {
  assertKey(key);
  if (typeof token !== "string" || token.length > 2048) throw new TypeError("Invalid worker ticket.");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new TypeError("Invalid worker ticket.");
  }
  const encodedHeader = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new TypeError("Invalid worker ticket.");
  }
  const signingInput = encodedHeader + "." + encodedPayload;
  const supplied = Buffer.from(encodedSignature, "base64url");
  // Node's base64url decoder accepts non-canonical trailing pad bits. Require
  // round-trip equality so alternate strings cannot alias a valid signature.
  if (supplied.toString("base64url") !== encodedSignature) {
    throw new TypeError("Invalid worker ticket.");
  }
  const expected = signature(signingInput, key);
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
    throw new TypeError("Invalid worker ticket.");
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new TypeError("Invalid worker ticket.");
  }
  if (header.alg !== "HS256" || header.typ !== "JWT" ||
      payload.iss !== ISSUER || payload.aud !== AUDIENCE ||
      typeof payload.tenant_id !== "string" || !payload.tenant_id ||
      typeof payload.execution_id !== "string" || !payload.execution_id ||
      payload.sub !== payload.execution_id ||
      typeof payload.lease_id !== "string" || !payload.lease_id ||
      typeof payload.jti !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(payload.jti) ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)) {
    throw new TypeError("Invalid worker ticket.");
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if ((payload.iat as number) > nowSeconds || (payload.exp as number) <= nowSeconds ||
      (payload.exp as number) <= (payload.iat as number) ||
      (payload.exp as number) - (payload.iat as number) > MAX_TTL_SECONDS) {
    throw new TypeError("Expired or invalid worker ticket.");
  }
  return {
    tenantId: payload.tenant_id, executionId: payload.execution_id,
    leaseId: payload.lease_id, issuedAt: payload.iat as number,
    expiresAt: payload.exp as number, tokenId: payload.jti
  };
}

/** Strict decoder for a dedicated 32-byte base64url worker-ticket key. */
export function decodeWorkerTicketSigningKey(encoded: string | undefined): Buffer | null {
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64url");
  return key.byteLength === 32 && key.toString("base64url") === encoded ? key : null;
}
