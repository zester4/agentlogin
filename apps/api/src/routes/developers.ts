import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  PostgresAgentCredentialRepository, PostgresDeveloperRepository
} from "@agentlogin/database";
import { AgentCredentialService } from "@agentlogin/identity";
import { decodeAgentSigningKey } from "../plugins/agent-auth.js";

const DeveloperBody = z.object({ name: z.string().trim().min(1).max(120) }).strict();
const AgentBody = z.object({
  name: z.string().trim().min(1).max(120),
  identity_type: z.string().trim().min(1).max(50)
}).strict();

export async function developerRoutes(app: FastifyInstance, options: { database: import("@agentlogin/database").Database }) {
  app.get("/v1/agents", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const agents = await new PostgresDeveloperRepository(options.database, request.userPrincipal.tenantId)
      .listManagedAgents(request.userPrincipal.userId);
    return reply.send({
      agents: agents.map((agent) => ({
        agent_id: agent.agentId,
        developer_id: agent.developerId,
        developer_name: agent.developerName,
        name: agent.name,
        identity_type: agent.identityType,
        status: agent.status,
        created_at: agent.createdAt.toISOString()
      }))
    });
  });

  app.post("/v1/agents/:agentId/suspend", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const agentId = (request.params as { agentId: string }).agentId;
    const repository = new PostgresDeveloperRepository(options.database, request.userPrincipal.tenantId);
    const managed = await repository.getManagedAgent(request.userPrincipal.userId, agentId);
    if (!managed) return reply.code(404).send({ error: { code: "agent_not_found", message: "The agent was not found." } });
    await repository.suspendAgent(agentId);
    return reply.send({ status: "suspended", agent_id: agentId });
  });

  app.post("/v1/developers", { preHandler: app.authenticateUser }, async (request, reply) => {
    const parsed = DeveloperBody.safeParse(request.body);
    if (!parsed.success || !request.userPrincipal) {
      return reply.code(400).send({ error: { code: "invalid_developer", message: "The developer name is invalid." } });
    }
    try {
      const result = await new PostgresDeveloperRepository(options.database, request.userPrincipal.tenantId)
        .createDeveloper({ userId: request.userPrincipal.userId, name: parsed.data.name });
      return reply.code(201).send({ developer_id: result.developerId });
    } catch {
      return reply.code(403).send({ error: { code: "developer_creation_denied", message: "Developer workspace could not be created." } });
    }
  });

  app.post("/v1/developers/:developerId/agents", { preHandler: app.authenticateUser }, async (request, reply) => {
    const parsed = AgentBody.safeParse(request.body);
    if (!parsed.success || !request.userPrincipal) {
      return reply.code(400).send({ error: { code: "invalid_agent", message: "The agent registration request is invalid." } });
    }
    const signingKey = decodeAgentSigningKey(process.env.AGENT_TOKEN_SIGNING_KEY);
    if (!signingKey) return reply.code(503).send({ error: { code: "agent_credential_issuance_unavailable", message: "Agent credential issuance is not configured." } });
    const developerId = (request.params as { developerId: string }).developerId;
    const repository = new PostgresDeveloperRepository(options.database, request.userPrincipal.tenantId);
    let agentId: string;
    try {
      ({ agentId } = await repository.createAgent({
        userId: request.userPrincipal.userId, developerId,
        name: parsed.data.name, identityType: parsed.data.identity_type
      }));
    } catch {
      return reply.code(403).send({ error: { code: "agent_registration_denied", message: "The agent could not be registered in this developer workspace." } });
    }
    try {
      const credentials = new AgentCredentialService(
        (tenantId) => new PostgresAgentCredentialRepository(options.database, tenantId), signingKey
      );
      const issued = await credentials.issue({
        tenantId: request.userPrincipal.tenantId, developerId, agentId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
      return reply.code(201).send({
        agent_id: agentId,
        credential: { token: issued.token, expires_at: issued.expiresAt, display_once: true }
      });
    } catch {
      await repository.suspendAgent(agentId).catch(() => undefined);
      return reply.code(503).send({ error: { code: "agent_credential_issuance_failed", message: "The agent was suspended because its credential could not be issued." } });
    }
  });

  app.post("/v1/agents/:agentId/credentials/rotate", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const signingKey = decodeAgentSigningKey(process.env.AGENT_TOKEN_SIGNING_KEY);
    if (!signingKey) return reply.code(503).send({ error: { code: "agent_credential_rotation_unavailable", message: "Agent credential rotation is not configured." } });
    const agentId = (request.params as { agentId: string }).agentId;
    const developerRepository = new PostgresDeveloperRepository(options.database, request.userPrincipal.tenantId);
    const agent = await developerRepository.getManagedAgent(request.userPrincipal.userId, agentId);
    if (!agent) return reply.code(404).send({ error: { code: "agent_not_found", message: "The agent was not found." } });
    try {
      const credentials = new AgentCredentialService(
        (tenantId) => new PostgresAgentCredentialRepository(options.database, tenantId), signingKey
      );
      const issued = await credentials.rotate({
        tenantId: request.userPrincipal.tenantId, developerId: agent.developerId, agentId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
      return reply.send({ credential: { token: issued.token, expires_at: issued.expiresAt, display_once: true } });
    } catch {
      return reply.code(503).send({ error: { code: "agent_credential_rotation_failed", message: "The agent credential could not be rotated." } });
    }
  });

  app.post("/v1/agent-credentials/:credentialId/revoke", { preHandler: app.authenticateUser }, async (request, reply) => {
    if (!request.userPrincipal) return reply.code(401).send({ error: { code: "unauthorized", message: "User authentication required." } });
    const credentialId = (request.params as { credentialId: string }).credentialId;
    const repository = new PostgresAgentCredentialRepository(options.database, request.userPrincipal.tenantId);
    const record = await repository.findById(credentialId);
    if (!record) return reply.code(404).send({ error: { code: "credential_not_found", message: "The agent credential was not found." } });
    const developers = new PostgresDeveloperRepository(options.database, request.userPrincipal.tenantId);
    if (!(await developers.canManageAgent(request.userPrincipal.userId, record.agentId))) {
      return reply.code(404).send({ error: { code: "credential_not_found", message: "The agent credential was not found." } });
    }
    const signingKey = decodeAgentSigningKey(process.env.AGENT_TOKEN_SIGNING_KEY);
    if (!signingKey) return reply.code(503).send({ error: { code: "agent_credential_revocation_unavailable", message: "Agent credential revocation is not configured." } });
    const service = new AgentCredentialService(
      (tenantId) => new PostgresAgentCredentialRepository(options.database, tenantId), signingKey
    );
    await service.revoke(credentialId, request.userPrincipal.tenantId);
    return reply.send({ status: "revoked", credential_id: credentialId });
  });
}
