import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PostgresConnectedAccountRepository, PostgresCredentialRecordStore, PostgresExecutionRepository } from "@agentlogin/database";
import { AwsKmsProvider, EncryptedCredentialVault } from "@agentlogin/vault";
import { OriginSchema } from "@agentlogin/contracts";

const AccountBody = z.object({
  provider: z.string().trim().min(1).max(80),
  origin: OriginSchema,
  display_label: z.string().trim().min(1).max(120),
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(4096)
}).strict();


const CredentialRotationBody = z.object({
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(4096)
}).strict();

export async function connectedAccountRoutes(app: FastifyInstance, options: { database: import("@agentlogin/database").Database }) {
  app.post("/v1/connected-accounts", { preHandler: app.authenticateUser }, async (request, reply) => {
    const parsed = AccountBody.safeParse(request.body);
    if (!parsed.success || !request.userPrincipal) {
      return reply.code(400).send({ error: { code: "invalid_connected_account", message: "The account enrollment request is invalid." } });
    }
    const url = new URL(parsed.data.origin);
    const localRequest = process.env.NODE_ENV !== "production" &&
      (request.hostname === "localhost" || request.hostname === "127.0.0.1");
    if (request.protocol !== "https" && !localRequest) {
      return reply.code(400).send({ error: { code: "https_required", message: "Credential enrollment must use HTTPS." } });
    }
    const localHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
    if (url.protocol !== "https:" && !localHttp) {
      return reply.code(400).send({ error: { code: "https_required", message: "Connected account origins must use HTTPS." } });
    }
    const keyId = process.env.AWS_KMS_KEY_ID;
    const region = process.env.AWS_REGION;
    if (!keyId || !region) {
      return reply.code(503).send({ error: { code: "credential_vault_unavailable", message: "Production credential encryption is not configured." } });
    }

    const accountRepository = new PostgresConnectedAccountRepository(options.database, request.userPrincipal.tenantId);
    let accountId: string;
    try {
      ({ accountId } = await accountRepository.create({
        userId: request.userPrincipal.userId, provider: parsed.data.provider,
        origin: parsed.data.origin, displayLabel: parsed.data.display_label
      }));
    } catch {
      return reply.code(503).send({ error: { code: "account_enrollment_failed", message: "The connected account could not be created." } });
    }

    const credentialId = "vcred_" + randomBytes(18).toString("base64url");
    const context = {
      tenantId: request.userPrincipal.tenantId, accountId, credentialId,
      recordVersion: 1, purpose: "website_login" as const
    };
    const plaintext = Buffer.from(JSON.stringify({
      username: parsed.data.username, password: parsed.data.password
    }), "utf8");
    // Remove the raw values from Fastify's request object as early as possible.
    const requestBody = request.body as Record<string, unknown>;
    requestBody.username = "[REDACTED]";
    requestBody.password = "[REDACTED]";
    parsed.data.username = "";
    parsed.data.password = "";
    try {
      const vault = new EncryptedCredentialVault(
        new PostgresCredentialRecordStore(options.database, request.userPrincipal.tenantId),
        new AwsKmsProvider(keyId, region)
      );
      await vault.store(context, plaintext);
      return reply.code(201).send({ account_id: accountId, status: "connected" });
    } catch {
      await accountRepository.disable(accountId, request.userPrincipal.userId).catch(() => undefined);
      return reply.code(503).send({ error: { code: "credential_enrollment_failed", message: "The credential could not be encrypted and stored; the account was disabled." } });
    } finally {
      plaintext.fill(0);
    }
  });

  app.post("/v1/connected-accounts/:accountId/revoke", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const accountId = (request.params as { accountId: string }).accountId;
    const disconnected = await new PostgresConnectedAccountRepository(options.database, request.userPrincipal.tenantId)
      .disconnect(accountId, request.userPrincipal.userId);
    if (!disconnected) return reply.code(404).send({ error: { code: "connected_account_not_found", message: "The connected account was not found." } });
    return reply.send({ status: "disconnected", account_id: accountId });
  });

  app.post("/v1/connected-accounts/:accountId/credentials/rotate", { preHandler: app.authenticateUser }, async (request, reply) => {
    const parsed = CredentialRotationBody.safeParse(request.body);
    if (!parsed.success || !request.userPrincipal) {
      return reply.code(400).send({ error: { code: "invalid_credential_rotation", message: "The credential rotation request is invalid." } });
    }
    const localRequest = process.env.NODE_ENV !== "production" &&
      (request.hostname === "localhost" || request.hostname === "127.0.0.1");
    if (request.protocol !== "https" && !localRequest) {
      return reply.code(400).send({ error: { code: "https_required", message: "Credential rotation must use HTTPS." } });
    }
    const keyId = process.env.AWS_KMS_KEY_ID;
    const region = process.env.AWS_REGION;
    if (!keyId || !region) {
      return reply.code(503).send({ error: { code: "credential_vault_unavailable", message: "Production credential encryption is not configured." } });
    }
    const accountId = (request.params as { accountId: string }).accountId;
    const current = await new PostgresExecutionRepository(options.database, request.userPrincipal.tenantId)
      .findLoginCredential({
        tenantId: request.userPrincipal.tenantId, accountId, userId: request.userPrincipal.userId
      });
    if (!current || current.status !== "active") {
      return reply.code(404).send({ error: { code: "connected_account_not_found", message: "The connected account was not found." } });
    }

    const body = request.body as Record<string, unknown>;
    body.username = "[REDACTED]";
    body.password = "[REDACTED]";
    const plaintext = Buffer.from(JSON.stringify({
      username: parsed.data.username, password: parsed.data.password
    }), "utf8");
    parsed.data.username = "";
    parsed.data.password = "";
    const previousContext = {
      tenantId: request.userPrincipal.tenantId, accountId,
      credentialId: current.credentialId, recordVersion: current.recordVersion,
      purpose: "website_login" as const
    };
    const nextContext = {
      ...previousContext,
      credentialId: "vcred_" + randomBytes(18).toString("base64url"),
      recordVersion: current.recordVersion + 1
    };
    try {
      const vault = new EncryptedCredentialVault(
        new PostgresCredentialRecordStore(options.database, request.userPrincipal.tenantId),
        new AwsKmsProvider(keyId, region)
      );
      const rotated = await vault.rotate(current.credentialRef, previousContext, nextContext, plaintext);
      return reply.send({ account_id: accountId, status: "credential_rotated", version: rotated.version });
    } catch {
      return reply.code(503).send({ error: { code: "credential_rotation_failed", message: "The credential could not be rotated; the previous version remains active." } });
    } finally {
      plaintext.fill(0);
    }
  });
}
