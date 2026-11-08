import { timingSafeEqual, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { AwsKmsProvider } from "@agentlogin/vault";
import type { CredentialContext, KeyManagementProvider } from "@agentlogin/vault";

function authorized(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

export async function kmsDiagnosticRoutes(
  app: FastifyInstance,
  options: { provider?: KeyManagementProvider } = {}
): Promise<void> {
  app.post("/internal/kms/self-test", async (request, reply) => {
    const token = process.env.KMS_DIAGNOSTIC_TOKEN;
    if (!token || token.length < 32) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }
    if (!authorized(request.headers.authorization, token)) {
      return reply.code(401).send({ error: { code: "unauthorized" } });
    }

    const keyId = process.env.AWS_KMS_KEY_ID;
    const region = process.env.AWS_REGION;
    if (!keyId || !region) {
      return reply.code(503).send({ status: "failed", checks: { configuration: false } });
    }

    const provider = options.provider ?? new AwsKmsProvider(keyId, region);
    const context: CredentialContext = {
      tenantId: "kms-self-test-" + randomBytes(12).toString("hex"),
      accountId: "synthetic-account",
      credentialId: "synthetic-credential-" + randomBytes(12).toString("hex"),
      recordVersion: 1,
      purpose: "website_login"
    };
    const dek = randomBytes(32);
    let wrapped: Uint8Array | undefined;
    let recovered: Uint8Array | undefined;
    let encrypt = false;
    let decrypt = false;
    let contextBinding = false;

    try {
      const result = await provider.wrapKey(dek, context);
      wrapped = result.wrappedDek;
      encrypt = wrapped.byteLength > 0 && Boolean(result.keyVersion);
      recovered = await provider.unwrapKey(wrapped, result.keyVersion, context);
      decrypt = recovered.byteLength === 32 && timingSafeEqual(dek, recovered);

      const alteredContext = { ...context, tenantId: context.tenantId + "-altered" };
      try {
        const wrongContextKey = await provider.unwrapKey(wrapped, result.keyVersion, alteredContext);
        wrongContextKey.fill(0);
        contextBinding = false;
      } catch {
        contextBinding = true;
      }

      const passed = encrypt && decrypt && contextBinding;
      return reply.code(passed ? 200 : 503).send({
        status: passed ? "passed" : "failed",
        checks: { kms_encrypt: encrypt, kms_decrypt: decrypt, encryption_context_rejection: contextBinding }
      });
    } catch {
      return reply.code(503).send({
        status: "failed",
        checks: { kms_encrypt: encrypt, kms_decrypt: decrypt, encryption_context_rejection: contextBinding }
      });
    } finally {
      dek.fill(0);
      recovered?.fill(0);
      wrapped?.fill(0);
    }
  });
}
