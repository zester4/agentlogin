import {
  createDatabase,
  PostgresCredentialLeaseRepository,
  PostgresExecutionRepository,
  PostgresGrantRepository
} from "@agentlogin/database";
import { GrantLifecycleService } from "@agentlogin/policy";
import {
  ExecutionCoordinator,
  HttpIsolatedBrowserProvider
} from "@agentlogin/execution";
import { buildApp } from "./app.js";
import { decodeAgentSigningKey } from "./plugins/agent-auth.js";
import { decodeWorkerTicketSigningKey } from "@agentlogin/execution";

const database = createDatabase();
const signingKey = decodeAgentSigningKey(process.env.AGENT_TOKEN_SIGNING_KEY);
const workerTicketSigningKey = decodeWorkerTicketSigningKey(process.env.AGENTLOGIN_WORKER_TICKET_SIGNING_KEY);
const workerUrl = process.env.AGENTLOGIN_WORKER_URL?.trim();
const validatedWorkerUrl = (() => {
  if (!workerUrl) return null;
  try {
    const parsed = new URL(workerUrl);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
})();
const workerUrlValid = validatedWorkerUrl !== null;

const isolatedBrowser = workerTicketSigningKey && validatedWorkerUrl
  ? new HttpIsolatedBrowserProvider({
      workerUrl: validatedWorkerUrl,
      signingKey: workerTicketSigningKey
    })
  : null;

if (!isolatedBrowser) {
  process.stderr.write(
    "[agentlogin] Login execution routes are disabled: worker configuration is invalid.\n"
  );
  process.stderr.write(JSON.stringify({
    event: "worker execution configuration rejected",
    workerUrlConfigured: Boolean(workerUrl),
    workerUrlValid,
    workerTicketKeyConfigured: Boolean(process.env.AGENTLOGIN_WORKER_TICKET_SIGNING_KEY),
    workerTicketKeyValid: Boolean(workerTicketSigningKey)
  }) + "\n");
}

const coordinatorForTenant = isolatedBrowser
  ? (tenantId: string) => {
      const grants = new GrantLifecycleService(
        new PostgresGrantRepository(database.db, tenantId)
      );
      const executionRecords = new PostgresExecutionRepository(database.db, tenantId);
      const leases = new PostgresCredentialLeaseRepository(database.db, tenantId);
      return new ExecutionCoordinator(
        grants,
        executionRecords,
        leases,
        isolatedBrowser,
        executionRecords
      );
    }
  : undefined;

const app = buildApp(database.pool, {
  database: database.db,
  signingKey,
  workerTicketSigningKey,
  ...(coordinatorForTenant ? { coordinatorForTenant } : {})
});

try {
  await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? "0.0.0.0" });
} catch (error) {
  app.log.error({ err: error }, "server startup failed");
  await app.close();
  process.exitCode = 1;
}
