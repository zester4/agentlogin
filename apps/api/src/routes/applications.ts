import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PostgresAgentCredentialRepository, PostgresApplicationCredentialRepository, PostgresDeveloperRepository } from "@agentlogin/database";
import { AgentCredentialService, ApplicationCredentialAuthenticationError, ApplicationCredentialService } from "@agentlogin/identity";
import { decodeAgentSigningKey } from "../plugins/agent-auth.js";
import { decodeApplicationSigningKey } from "../plugins/application-auth.js";

const TokenBody = z.object({ grant_type: z.literal("client_credentials") }).strict();
const ApplicationBody = z.object({ name: z.string().trim().min(1).max(120) }).strict();
const AgentBody = z.object({
  name: z.string().trim().min(1).max(120),
  identity_type: z.string().trim().min(1).max(50)
}).strict();

function basicCredentials(header: string | undefined): { clientId: string; clientSecret: string } | null {
  if (!header?.startsWith("Basic ") || header.length > 8192) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator <= 0) return null;
    return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
  } catch { return null; }
}

export async function applicationRoutes(app: FastifyInstance, options: { database: import("@agentlogin/database").Database }) {

  app.get("/v1/developers", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const developers = await new PostgresDeveloperRepository(options.database, request.userPrincipal.tenantId)
      .listManagedDevelopers(request.userPrincipal.userId);
    return reply.send({ developers: developers.map((item) => ({
      developer_id: item.developerId, name: item.name, status: item.status,
      role: item.role, created_at: item.createdAt.toISOString()
    })) });
  });

  app.get("/v1/developers/:developerId/applications", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const developerId = (request.params as { developerId: string }).developerId;
    const applications = await new PostgresApplicationCredentialRepository(options.database, request.userPrincipal.tenantId)
      .listApplications(request.userPrincipal.userId, developerId);
    return reply.send({ applications: applications.map((item) => ({
      application_id: item.applicationId, name: item.name, client_id: item.clientId,
      status: item.status, created_at: item.createdAt.toISOString()
    })) });
  });

  app.post("/oauth/token", async (request, reply) => {
    const parsedBody = TokenBody.safeParse(request.body);
    const credentials = basicCredentials(request.headers.authorization);
    if (!parsedBody.success || !credentials) {
      return reply.code(400).header("Cache-Control", "no-store").send({
        error: "invalid_request", error_description: "Use grant_type=client_credentials and HTTP Basic client authentication."
      });
    }
    const signingKey = decodeApplicationSigningKey(process.env.APPLICATION_TOKEN_SIGNING_KEY);
    if (!signingKey) return reply.code(503).header("Cache-Control", "no-store").send({
      error: "temporarily_unavailable", error_description: "Application token issuance is not configured."
    });
    try {
      const service = new ApplicationCredentialService(
        (tenantId) => new PostgresApplicationCredentialRepository(options.database, tenantId), signingKey
      );
      const token = await service.exchange(credentials);
      return reply.header("Cache-Control", "no-store").header("Pragma", "no-cache").send(token);
    } catch (error) {
      if (!(error instanceof ApplicationCredentialAuthenticationError)) {
        request.log.error({ err: { name: error instanceof Error ? error.name : "UnknownError" } }, "OAuth client credentials exchange failed");
      }
      return reply.code(401).header("Cache-Control", "no-store").header("WWW-Authenticate", 'Basic realm="AgentLogin OAuth"')
        .send({ error: "invalid_client", error_description: "Client authentication failed." });
    }
  });

  app.post("/v1/developers/:developerId/applications", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const parsed = ApplicationBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_application", message: "The application name is invalid." } });
    const signingKey = decodeApplicationSigningKey(process.env.APPLICATION_TOKEN_SIGNING_KEY);
    if (!signingKey) return reply.code(503).send({ error: { code: "application_credentials_unavailable", message: "Application credentials are not configured." } });
    const developerId = (request.params as { developerId: string }).developerId;
    try {
      const service = new ApplicationCredentialService(
        (tenantId) => new PostgresApplicationCredentialRepository(options.database, tenantId), signingKey
      );
      const issued = await service.create({
        tenantId: request.userPrincipal.tenantId,
        userId: request.userPrincipal.userId,
        developerId,
        name: parsed.data.name
      });
      return reply.code(201).send({
        application_id: issued.applicationId,
        client_id: issued.clientId,
        client_secret: issued.clientSecret,
        display_once: true
      });
    } catch {
      return reply.code(403).send({ error: { code: "application_creation_denied", message: "The application could not be created in this developer workspace." } });
    }
  });

  app.post("/v1/app/agents", { preHandler: app.authenticateApplication }, async (request, reply) => {
    const principal = request.applicationPrincipal;
    const parsed = AgentBody.safeParse(request.body);
    if (!principal) return reply.code(401).send({ error: { code: "unauthorized", message: "Application authentication required." } });
    if (!principal.scopes.includes("agents:manage")) return reply.code(403).send({ error: { code: "insufficient_scope", message: "The application cannot manage agents." } });
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_agent", message: "The agent registration request is invalid." } });
    const signingKey = decodeAgentSigningKey(process.env.AGENT_TOKEN_SIGNING_KEY);
    if (!signingKey) return reply.code(503).send({ error: { code: "agent_credential_issuance_unavailable", message: "Agent credential issuance is not configured." } });
    const developers = new PostgresDeveloperRepository(options.database, principal.tenantId);
    let agentId: string;
    try {
      ({ agentId } = await developers.createAgentForApplication({
        developerId: principal.developerId, name: parsed.data.name, identityType: parsed.data.identity_type
      }));
    } catch {
      return reply.code(403).send({ error: { code: "agent_registration_denied", message: "The agent could not be registered for this application." } });
    }
    try {
      const credentials = new AgentCredentialService(
        (tenantId) => new PostgresAgentCredentialRepository(options.database, tenantId), signingKey
      );
      const issued = await credentials.issue({
        tenantId: principal.tenantId, developerId: principal.developerId, agentId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
      return reply.code(201).send({
        agent_id: agentId,
        credential: { token: issued.token, expires_at: issued.expiresAt, display_once: true }
      });
    } catch {
      await developers.suspendAgent(agentId).catch(() => undefined);
      return reply.code(503).send({ error: { code: "agent_credential_issuance_failed", message: "The agent was suspended because its credential could not be issued." } });
    }
  });
}
