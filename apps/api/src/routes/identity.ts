import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import {
  AGENT_SCOPES,
  DEFAULT_CREDENTIAL_TTL_SECONDS,
  MAX_CREDENTIAL_TTL_SECONDS,
  constantTimeEqual,
  issueAgentCredential,
  issueDeveloperCredential,
  newId
} from "../identity/credentials.js";
import { IdentityService } from "../identity/service.js";
import type { IdentityStore, Principal, DeveloperPrincipal, AgentPrincipal, UserPrincipal } from "../identity/types.js";
import type { UserTokenVerifier } from "../identity/user-jwt.js";
import { InvalidUserTokenError } from "../identity/user-jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    identity: Principal | null;
  }
}

type IdentityRoutesOptions = {
  store: IdentityStore | null;
  userTokenVerifier: UserTokenVerifier | null;
  bootstrapSecret: string | null;
};

const NameSchema = z.string().trim().min(2).max(120);
const BootstrapSchema = z.object({
  tenant_name: NameSchema,
  developer_name: NameSchema,
  owner_issuer: z.string().url().max(500),
  owner_subject: z.string().trim().min(1).max(255)
}).strict();
const CreateDeveloperSchema = z.object({ name: NameSchema }).strict();
const CreateAgentSchema = z.object({ name: NameSchema }).strict();
const CredentialSchema = z.object({
  scopes: z.array(z.enum(AGENT_SCOPES)).min(1).max(1).default(["agent:read"]),
  ttl_seconds: z.number().int().min(3600).max(MAX_CREDENTIAL_TTL_SECONDS).default(DEFAULT_CREDENTIAL_TTL_SECONDS)
}).strict();

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

function unauthorized(reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  return reply.code(401).send({ error: { code: "unauthorized", message: "Valid authentication is required." } });
}

function unavailable(reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  return reply.code(503).send({ error: { code: "identity_not_configured", message: "Identity services are not configured." } });
}

function invalidRequest(reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  return reply.code(400).send({ error: { code: "invalid_request", message: "The request body is invalid." } });
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown, reply: Parameters<typeof invalidRequest>[0]): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    invalidRequest(reply);
    return null;
  }
  return parsed.data;
}

function hasScope(principal: Principal, scope: string): boolean {
  return principal.scopes.includes(scope);
}

function noStore(reply: { header: (name: string, value: string) => unknown }) {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
}

function developer(request: FastifyRequest): DeveloperPrincipal {
  return request.identity as DeveloperPrincipal;
}

function agent(request: FastifyRequest): AgentPrincipal {
  return request.identity as AgentPrincipal;
}

function user(request: FastifyRequest): UserPrincipal {
  return request.identity as UserPrincipal;
}

export async function identityRoutes(app: FastifyInstance, options: IdentityRoutesOptions) {
  app.decorateRequest("identity", null);
  const service = options.store ? new IdentityService(options.store, options.userTokenVerifier) : null;

  const requireDeveloper: preHandlerHookHandler = async (request, reply) => {
    if (!service) return unavailable(reply);
    const token = bearerToken(request);
    if (!token) return unauthorized(reply);
    const principal = await service.authenticateDeveloper(token);
    if (!principal) return unauthorized(reply);
    request.identity = principal;
  };

  const requireAgent: preHandlerHookHandler = async (request, reply) => {
    if (!service) return unavailable(reply);
    const token = bearerToken(request);
    if (!token) return unauthorized(reply);
    const principal = await service.authenticateAgent(token);
    if (!principal) return unauthorized(reply);
    request.identity = principal;
  };

  const requireUser: preHandlerHookHandler = async (request, reply) => {
    if (!service || !options.userTokenVerifier) return unavailable(reply);
    const token = bearerToken(request);
    if (!token) return unauthorized(reply);
    try {
      const principal = await service.authenticateUser(token);
      if (!principal) return unauthorized(reply);
      request.identity = principal;
    } catch (error) {
      if (error instanceof InvalidUserTokenError) return unauthorized(reply);
      throw error;
    }
  };

  app.post("/v1/bootstrap/tenants", async (request, reply) => {
    if (!options.store || !options.userTokenVerifier || !options.bootstrapSecret) return unavailable(reply);
    const supplied = request.headers["x-agentlogin-bootstrap-secret"];
    if (typeof supplied !== "string" || !constantTimeEqual(supplied, options.bootstrapSecret)) return unauthorized(reply);
    const body = parseBody(BootstrapSchema, request.body, reply);
    if (!body) return;
    if (body.owner_issuer !== options.userTokenVerifier.issuer) return invalidRequest(reply);

    const tenantId = newId("ten");
    const userId = newId("usr");
    const developerId = newId("dev");
    const credential = issueDeveloperCredential(tenantId, developerId);
    await options.store.bootstrapTenant({
      tenantId,
      tenantName: body.tenant_name,
      userId,
      ownerIssuer: body.owner_issuer,
      ownerSubject: body.owner_subject,
      developerId,
      developerName: body.developer_name,
      credential
    });
    noStore(reply);
    return reply.code(201).send({
      tenant_id: tenantId,
      user_id: userId,
      developer_id: developerId,
      developer_key: credential.token,
      developer_key_expires_at: credential.expiresAt.toISOString(),
      scopes: credential.scopes
    });
  });

  app.post("/v1/developers", { preHandler: requireUser }, async (request, reply) => {
    if (!options.store) return unavailable(reply);
    const principal = user(request);
    if (principal.role !== "owner" && principal.role !== "admin") {
      return reply.code(403).send({ error: { code: "forbidden", message: "Tenant administrator access is required." } });
    }
    const body = parseBody(CreateDeveloperSchema, request.body, reply);
    if (!body) return;
    const developerId = newId("dev");
    const credential = issueDeveloperCredential(principal.tenantId, developerId);
    const created = await options.store.createDeveloper({
      tenantId: principal.tenantId,
      userId: principal.userId,
      developerId,
      developerName: body.name,
      credential
    });
    if (!created) return reply.code(403).send({ error: { code: "forbidden", message: "Developer creation is not permitted." } });
    noStore(reply);
    return reply.code(201).send({
      developer_id: developerId,
      developer_key: credential.token,
      developer_key_expires_at: credential.expiresAt.toISOString(),
      scopes: credential.scopes,
      delivery: "one_time_authenticated_user_response_only"
    });
  });

  app.get("/v1/developer/me", { preHandler: requireDeveloper }, async (request, reply) => {
    const principal = developer(request);
    if (!hasScope(principal, "developer:read")) return reply.code(403).send({ error: { code: "scope_denied" } });
    return { tenant_id: principal.tenantId, developer_id: principal.developerId, credential_id: principal.credentialId, scopes: principal.scopes };
  });

  app.post("/v1/agents", { preHandler: requireDeveloper }, async (request, reply) => {
    if (!options.store) return unavailable(reply);
    const principal = developer(request);
    if (!hasScope(principal, "agents:manage")) return reply.code(403).send({ error: { code: "scope_denied" } });
    const body = parseBody(CreateAgentSchema, request.body, reply);
    if (!body) return;
    const created = await options.store.createAgent({
      tenantId: principal.tenantId,
      developerId: principal.developerId,
      agentId: newId("agt"),
      name: body.name
    });
    if (!created) return reply.code(404).send({ error: { code: "not_found" } });
    return reply.code(201).send({
      agent_id: created.id,
      name: created.name,
      identity_type: created.identityType,
      status: created.status,
      created_at: created.createdAt.toISOString()
    });
  });

  app.get("/v1/agents", { preHandler: requireDeveloper }, async (request, reply) => {
    const principal = developer(request);
    if (!hasScope(principal, "agents:manage")) return reply.code(403).send({ error: { code: "scope_denied" } });
    const rows = await options.store!.listAgents({ tenantId: principal.tenantId, developerId: principal.developerId });
    return { agents: rows.map((row) => ({ agent_id: row.id, name: row.name, status: row.status, identity_type: row.identityType, created_at: row.createdAt.toISOString() })) };
  });

  app.get("/v1/agents/:agentId", { preHandler: requireDeveloper }, async (request, reply) => {
    const principal = developer(request);
    if (!hasScope(principal, "agents:manage")) return reply.code(403).send({ error: { code: "scope_denied" } });
    const params = request.params as { agentId: string };
    const row = await options.store!.getAgent({ tenantId: principal.tenantId, developerId: principal.developerId, agentId: params.agentId });
    if (!row) return reply.code(404).send({ error: { code: "not_found" } });
    return { agent_id: row.id, name: row.name, status: row.status, identity_type: row.identityType, created_at: row.createdAt.toISOString() };
  });

  app.post("/v1/agents/:agentId/credentials", { preHandler: requireDeveloper }, async (request, reply) => {
    if (!options.store) return unavailable(reply);
    const principal = developer(request);
    if (!hasScope(principal, "agents:manage")) return reply.code(403).send({ error: { code: "scope_denied" } });
    const body = parseBody(CredentialSchema, request.body ?? {}, reply);
    if (!body) return;
    const params = request.params as { agentId: string };
    const credential = issueAgentCredential(principal.tenantId, principal.developerId, params.agentId, body.scopes, body.ttl_seconds);
    const created = await options.store.createAgentCredential({
      tenantId: principal.tenantId,
      developerId: principal.developerId,
      credential
    });
    if (!created) return reply.code(404).send({ error: { code: "not_found" } });
    noStore(reply);
    return reply.code(201).send({
      credential_id: credential.id,
      agent_credential: credential.token,
      expires_at: credential.expiresAt.toISOString(),
      scopes: credential.scopes,
      delivery: "one_time_developer_response_only"
    });
  });

  app.post("/v1/agents/:agentId/credentials/:credentialId/revoke", { preHandler: requireDeveloper }, async (request, reply) => {
    if (!options.store) return unavailable(reply);
    const principal = developer(request);
    if (!hasScope(principal, "agents:manage")) return reply.code(403).send({ error: { code: "scope_denied" } });
    const params = request.params as { agentId: string; credentialId: string };
    const revoked = await options.store.revokeAgentCredential({
      tenantId: principal.tenantId,
      developerId: principal.developerId,
      agentId: params.agentId,
      credentialId: params.credentialId
    });
    if (!revoked) return reply.code(404).send({ error: { code: "not_found" } });
    return { status: "revoked", credential_id: params.credentialId };
  });

  app.post("/v1/agents/:agentId/credentials/:credentialId/rotate", { preHandler: requireDeveloper }, async (request, reply) => {
    if (!options.store) return unavailable(reply);
    const principal = developer(request);
    if (!hasScope(principal, "agents:manage")) return reply.code(403).send({ error: { code: "scope_denied" } });
    const body = parseBody(CredentialSchema, request.body ?? {}, reply);
    if (!body) return;
    const params = request.params as { agentId: string; credentialId: string };
    const credential = issueAgentCredential(principal.tenantId, principal.developerId, params.agentId, body.scopes, body.ttl_seconds);
    const rotated = await options.store.rotateAgentCredential({
      tenantId: principal.tenantId,
      developerId: principal.developerId,
      agentId: params.agentId,
      oldCredentialId: params.credentialId,
      credential
    });
    if (!rotated) return reply.code(404).send({ error: { code: "not_found" } });
    noStore(reply);
    return {
      status: "rotated",
      credential_id: credential.id,
      agent_credential: credential.token,
      expires_at: credential.expiresAt.toISOString(),
      scopes: credential.scopes,
      delivery: "one_time_developer_response_only"
    };
  });

  app.post("/v1/developer-keys/:credentialId/revoke", { preHandler: requireDeveloper }, async (request, reply) => {
    if (!options.store) return unavailable(reply);
    const principal = developer(request);
    if (!hasScope(principal, "keys:manage")) return reply.code(403).send({ error: { code: "scope_denied" } });
    const params = request.params as { credentialId: string };
    const revoked = await options.store.revokeDeveloperCredential({
      tenantId: principal.tenantId,
      developerId: principal.developerId,
      credentialId: params.credentialId
    });
    if (!revoked) return reply.code(404).send({ error: { code: "not_found" } });
    return { status: "revoked", credential_id: params.credentialId };
  });

  app.post("/v1/developer-keys/:credentialId/rotate", { preHandler: requireDeveloper }, async (request, reply) => {
    if (!options.store) return unavailable(reply);
    const principal = developer(request);
    if (!hasScope(principal, "keys:manage")) return reply.code(403).send({ error: { code: "scope_denied" } });
    const params = request.params as { credentialId: string };
    const credential = issueDeveloperCredential(principal.tenantId, principal.developerId);
    const rotated = await options.store.rotateDeveloperCredential({
      tenantId: principal.tenantId,
      developerId: principal.developerId,
      oldCredentialId: params.credentialId,
      credential
    });
    if (!rotated) return reply.code(404).send({ error: { code: "not_found" } });
    noStore(reply);
    return {
      status: "rotated",
      credential_id: credential.id,
      developer_key: credential.token,
      expires_at: credential.expiresAt.toISOString(),
      scopes: credential.scopes,
      delivery: "one_time_developer_response_only"
    };
  });

  app.get("/v1/agent/me", { preHandler: requireAgent }, async (request, reply) => {
    const principal = agent(request);
    if (!hasScope(principal, "agent:read")) return reply.code(403).send({ error: { code: "scope_denied" } });
    return {
      tenant_id: principal.tenantId,
      developer_id: principal.developerId,
      agent_id: principal.agentId,
      credential_id: principal.credentialId,
      scopes: principal.scopes
    };
  });

  app.get("/v1/user/me", { preHandler: requireUser }, async (request) => {
    const principal = user(request);
    return { tenant_id: principal.tenantId, user_id: principal.userId, role: principal.role };
  });
}
