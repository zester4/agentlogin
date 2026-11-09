import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PostgresCredentialLeaseRepository, type Database } from "@agentlogin/database";
import { verifyWorkerTicket } from "@agentlogin/execution";

const ConsumeBody = z.object({
  lease_id: z.string().min(1).max(200),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
}).strict();

export interface CredentialLeaseConsumer {
  consume(input: { leaseId: string; token: string }): Promise<{
    credentialRef: string; credentialId: string; recordVersion: number;
    tenantId: string; userId: string; agentId: string; grantId: string;
    accountId: string; origin: string; executionId: string;
  } | null>;
}

/**
 * Internal worker-only capability exchange. Tenant identity is derived solely
 * from the verified ticket; the body cannot select a tenant or execution.
 * This endpoint returns an opaque vault reference, never plaintext credentials.
 */
export async function credentialBrokerRoutes(
  app: FastifyInstance,
  options: {
    database: Database;
    signingKey: Uint8Array;
    consumerForTenant?: (verifiedTenantId: string) => CredentialLeaseConsumer;
  }
) {
  app.post("/internal/v1/credential-leases/consume", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ") || authorization.length > 2100) {
      return reply.code(401).send({ error: { code: "worker_unauthorized", message: "A valid internal worker ticket is required." } });
    }

    let claims: ReturnType<typeof verifyWorkerTicket>;
    try {
      claims = verifyWorkerTicket(authorization.slice(7), options.signingKey);
    } catch {
      return reply.code(401).send({ error: { code: "worker_unauthorized", message: "A valid internal worker ticket is required." } });
    }

    const parsed = ConsumeBody.safeParse(request.body);
    if (!parsed.success || parsed.data.lease_id !== claims.leaseId) {
      return reply.code(400).send({ error: { code: "invalid_lease_request", message: "The lease request does not match the worker ticket." } });
    }

    try {
      const consumer = options.consumerForTenant
        ? options.consumerForTenant(claims.tenantId)
        : new PostgresCredentialLeaseRepository(options.database, claims.tenantId);
      const consumed = await consumer.consume({
        leaseId: claims.leaseId,
        token: parsed.data.token
      });
      if (!consumed || consumed.tenantId !== claims.tenantId ||
          consumed.executionId !== claims.executionId) {
        return reply.code(404).send({ error: { code: "lease_not_found", message: "The credential lease is unavailable." } });
      }
      return reply.code(200).send({
        lease_id: claims.leaseId,
        execution_id: consumed.executionId,
        account_id: consumed.accountId,
        origin: consumed.origin,
        credential_ref: consumed.credentialRef,
        credential_id: consumed.credentialId,
        record_version: consumed.recordVersion
      });
    } catch {
      request.log.error({ tenantId: claims.tenantId, executionId: claims.executionId }, "credential lease consumption failed");
      return reply.code(503).send({ error: { code: "credential_broker_unavailable", message: "The credential broker is temporarily unavailable." } });
    }
  });
}
