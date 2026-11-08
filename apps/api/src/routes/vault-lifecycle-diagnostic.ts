import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  PostgresConnectedAccountRepository,
  PostgresCredentialRecordStore,
  type Database
} from "@agentlogin/database";
import {
  AwsKmsProvider,
  CredentialDecryptionError,
  EncryptedCredentialVault
} from "@agentlogin/vault";

function authorized(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

type Checks = {
  account_created: boolean;
  ciphertext_only_persistence: boolean;
  callback_decryption: boolean;
  callback_buffer_cleared: boolean;
  tenant_isolation: boolean;
  credential_rotation: boolean;
  credential_revocation: boolean;
  account_disconnect: boolean;
};

export async function vaultLifecycleDiagnosticRoutes(
  app: FastifyInstance,
  options: { database?: Database }
): Promise<void> {
  app.post("/internal/vault/lifecycle-self-test", async (request, reply) => {
    const token = process.env.VAULT_LIFECYCLE_DIAGNOSTIC_TOKEN;
    if (!token || token.length < 32) return reply.code(404).send({ error: { code: "not_found" } });
    if (!authorized(request.headers.authorization, token)) {
      return reply.code(401).send({ error: { code: "unauthorized" } });
    }

    const database = options.database;
    const keyId = process.env.AWS_KMS_KEY_ID;
    const region = process.env.AWS_REGION;
    const tenantId = process.env.AGENTLOGIN_TEST_TENANT_ID;
    const userId = process.env.AGENTLOGIN_TEST_USER_ID;
    if (!database || !keyId || !region || !tenantId || !userId ||
        !tenantId.startsWith("ten_vault_test_") || !userId.startsWith("usr_vault_test_")) {
      return reply.code(503).send({
        status: "failed",
        checks: { configuration: false }
      });
    }

    const checks: Checks = {
      account_created: false,
      ciphertext_only_persistence: false,
      callback_decryption: false,
      callback_buffer_cleared: false,
      tenant_isolation: false,
      credential_rotation: false,
      credential_revocation: false,
      account_disconnect: false
    };
    const accounts = new PostgresConnectedAccountRepository(database, tenantId);
    const records = new PostgresCredentialRecordStore(database, tenantId);
    const vault = new EncryptedCredentialVault(records, new AwsKmsProvider(keyId, region));
    let accountId = "";
    let currentContext: {
      tenantId: string;
      accountId: string;
      credentialId: string;
      recordVersion: number;
      purpose: "website_login";
    } | undefined;

    try {
      ({ accountId } = await accounts.create({
        userId,
        provider: "agentlogin-vault-integration-test",
        origin: "https://vault-integration.invalid",
        displayLabel: "Temporary synthetic vault lifecycle test"
      }));
      checks.account_created = true;

      const password = "agentlogin-synthetic-" + randomBytes(16).toString("hex");
      currentContext = {
        tenantId, accountId,
        credentialId: "vcred_" + randomBytes(18).toString("base64url"),
        recordVersion: 1, purpose: "website_login"
      };
      const firstPlaintext = Buffer.from(JSON.stringify({
        username: "synthetic-user@vault-integration.invalid", password
      }), "utf8");
      const first = await vault.store(currentContext, firstPlaintext);
      firstPlaintext.fill(0);

      const persisted = await records.find(first.credentialRef, tenantId, currentContext.credentialId);
      checks.ciphertext_only_persistence = Boolean(
        persisted &&
        persisted.envelope.algorithm === "AES-256-GCM" &&
        persisted.envelope.iv.byteLength === 12 &&
        persisted.envelope.authTag.byteLength === 16 &&
        persisted.envelope.wrappedDek.byteLength > 0 &&
        persisted.envelope.keyVersion.includes(":key/") &&
        !Buffer.from(persisted.envelope.ciphertext).includes(Buffer.from(password)) &&
        !Buffer.from(persisted.envelope.wrappedDek).includes(Buffer.from(password))
      );

      let callbackBuffer: Uint8Array | undefined;
      const recovered = await vault.withDecryptedCredential(first.credentialRef, currentContext, async (secret) => {
        callbackBuffer = secret;
        const parsed = JSON.parse(Buffer.from(secret).toString("utf8")) as { username: string; password: string };
        return parsed.username === "synthetic-user@vault-integration.invalid" && parsed.password === password;
      });
      checks.callback_decryption = recovered === true;
      checks.callback_buffer_cleared = Boolean(callbackBuffer?.every((byte) => byte === 0));
      checks.tenant_isolation = await records.find(first.credentialRef, "ten_vault_test_wrong_tenant", currentContext.credentialId) === null;

      const nextContext = {
        ...currentContext,
        credentialId: "vcred_" + randomBytes(18).toString("base64url"),
        recordVersion: 2
      };
      const rotatedPassword = password + "-rotated";
      const nextPlaintext = Buffer.from(JSON.stringify({
        username: "synthetic-user@vault-integration.invalid", password: rotatedPassword
      }), "utf8");
      const rotated = await vault.rotate(first.credentialRef, currentContext, nextContext, nextPlaintext);
      nextPlaintext.fill(0);
      let oldRejected = false;
      try {
        await vault.withDecryptedCredential(first.credentialRef, currentContext, async () => "unexpected");
      } catch (error) {
        oldRejected = error instanceof CredentialDecryptionError;
      }
      const newRecovered = await vault.withDecryptedCredential(rotated.credentialRef, nextContext, async (secret) => {
        const parsed = JSON.parse(Buffer.from(secret).toString("utf8")) as { password: string };
        return parsed.password;
      });
      checks.credential_rotation = oldRejected && newRecovered === rotatedPassword;
      currentContext = nextContext;

      await vault.revoke(rotated.credentialRef, nextContext);
      let revokedRejected = false;
      try {
        await vault.withDecryptedCredential(rotated.credentialRef, nextContext, async () => "unexpected");
      } catch (error) {
        revokedRejected = error instanceof CredentialDecryptionError;
      }
      checks.credential_revocation = revokedRejected;

      checks.account_disconnect = await accounts.disconnect(accountId, userId);
      const afterDisconnect = await records.find(rotated.credentialRef, tenantId, nextContext.credentialId);
      checks.account_disconnect = checks.account_disconnect && afterDisconnect === null;

      const passed = Object.values(checks).every(Boolean);
      return reply.code(passed ? 200 : 503).send({
        status: passed ? "passed" : "failed",
        checks
      });
    } catch {
      return reply.code(503).send({ status: "failed", checks });
    } finally {
      if (accountId) await accounts.disconnect(accountId, userId).catch(() => false);
      // Credential records remain revoked for auditability; only synthetic values are used.
    }
  });
}
