import { and, eq, isNull } from "drizzle-orm";
import type { TenantTransaction } from "./types.js";
import {
  agentCredentials,
  auditEvents,
  connectedAccounts,
  grants,
} from "./schema.js";

/** Returns account metadata only. Credential material is never selected here. */
export async function findConnectedAccount(
  tx: TenantTransaction,
  accountId: string,
) {
  const [account] = await tx
    .select({
      id: connectedAccounts.id,
      tenantId: connectedAccounts.tenantId,
      userId: connectedAccounts.userId,
      provider: connectedAccounts.provider,
      origin: connectedAccounts.origin,
      displayLabel: connectedAccounts.displayLabel,
      status: connectedAccounts.status,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, accountId))
    .limit(1);

  return account ?? null;
}

/** Returns only the token hash and lifecycle metadata required by auth. */
export async function findAgentCredentialForVerification(
  tx: TenantTransaction,
  credentialId: string,
) {
  const [credential] = await tx
    .select({
      id: agentCredentials.id,
      tenantId: agentCredentials.tenantId,
      developerId: agentCredentials.developerId,
      agentId: agentCredentials.agentId,
      tokenHash: agentCredentials.tokenHash,
      expiresAt: agentCredentials.expiresAt,
      revokedAt: agentCredentials.revokedAt,
    })
    .from(agentCredentials)
    .where(eq(agentCredentials.id, credentialId))
    .limit(1);

  return credential ?? null;
}

/** Fetches a grant candidate; callers must still run the full policy check. */
export async function findGrantForAuthorization(
  tx: TenantTransaction,
  grantId: string,
) {
  const [grant] = await tx
    .select()
    .from(grants)
    .where(and(eq(grants.id, grantId), isNull(grants.revokedAt)))
    .limit(1);

  return grant ?? null;
}

/**
 * Audit metadata must be pre-sanitized. Never pass passwords, tokens, cookies,
 * authorization headers, plaintext credentials, or browser/session secrets.
 */
export async function appendAuditEvent(
  tx: TenantTransaction,
  event: typeof auditEvents.$inferInsert,
) {
  await tx.insert(auditEvents).values(event);
}
