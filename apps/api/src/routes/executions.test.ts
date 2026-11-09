import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostgresGrantRepository } from "@agentlogin/database";
import { executionRoutes } from "./executions.js";

const grant = {
  id: "grt_test", tenantId: "tenant_test", userId: "owner_test",
  agentId: "agent_test", accountId: "account_test", origin: "https://accounts.example.com",
  scopes: ["autofill_login"], taskId: null, policyVersion: 7,
  issuedAt: new Date("2026-11-01T00:00:00Z"), expiresAt: new Date("2026-12-01T00:00:00Z"),
  revokedAt: null, approvalId: "approval_test", approvedAt: new Date("2026-11-01T00:00:00Z"),
  approvalDecision: "approved", tenantStatus: "active", userStatus: "active",
  agentStatus: "active", developerStatus: "active", accountStatus: "active"
};

afterEach(() => vi.restoreAllMocks());

describe("agent login execution API boundary", () => {
  it("derives owner, account, origin and policy version from the stored grant", async () => {
    vi.spyOn(PostgresGrantRepository.prototype, "find").mockResolvedValue(grant as never);
    const login = vi.fn().mockResolvedValue({ status: "login_succeeded", execution_id: "exe_test" });
    const app = Fastify({ logger: false });
    app.decorateRequest("agentPrincipal", null);
    app.decorate("authenticateAgent", async (request) => {
      request.agentPrincipal = {
        tenantId: "tenant_test", developerId: "developer_test",
        agentId: "agent_test", credentialId: "agent_credential_test"
      };
    });
    await executionRoutes(app, {
      database: {} as never,
      coordinatorForTenant: () => ({ login } as never)
    });

    const response = await app.inject({
      method: "POST", url: "/v1/executions/login",
      payload: {
        grant_id: "grt_test", task_id: "task_test",
        user_id: "attacker_user", account_id: "attacker_account",
        origin: "https://attacker.example", expected_policy_version: 999
      }
    });
    expect(response.statusCode).toBe(400); // strict schema rejects caller-supplied identity/policy fields
    expect(login).not.toHaveBeenCalled();
    await app.close();

    const app2 = Fastify({ logger: false });
    app2.decorateRequest("agentPrincipal", null);
    app2.decorate("authenticateAgent", async (request) => {
      request.agentPrincipal = {
        tenantId: "tenant_test", developerId: "developer_test",
        agentId: "agent_test", credentialId: "agent_credential_test"
      };
    });
    await executionRoutes(app2, {
      database: {} as never,
      coordinatorForTenant: () => ({ login } as never)
    });
    const valid = await app2.inject({
      method: "POST", url: "/v1/executions/login",
      payload: { grant_id: "grt_test", task_id: "task_test" }
    });
    expect(valid.statusCode).toBe(200);
    expect(login).toHaveBeenCalledWith({
      principal: {
        tenantId: "tenant_test", userId: "owner_test",
        agentId: "agent_test", credentialId: "agent_credential_test"
      },
      grantId: "grt_test", accountId: "account_test",
      origin: "https://accounts.example.com", expectedPolicyVersion: 7,
      taskId: "task_test"
    });
    await app2.close();
  });

  it("does not reveal grants belonging to another tenant or agent", async () => {
    vi.spyOn(PostgresGrantRepository.prototype, "find").mockResolvedValue({
      ...grant, agentId: "some_other_agent"
    } as never);
    const app = Fastify({ logger: false });
    app.decorateRequest("agentPrincipal", null);
    app.decorate("authenticateAgent", async (request) => {
      request.agentPrincipal = {
        tenantId: "tenant_test", developerId: "developer_test",
        agentId: "agent_test", credentialId: "agent_credential_test"
      };
    });
    await executionRoutes(app, { database: {} as never, coordinatorForTenant: () => ({ login: vi.fn() } as never) });
    const response = await app.inject({ method: "POST", url: "/v1/executions/login", payload: { grant_id: "grt_test" } });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("grant_not_found");
    await app.close();
  });
});
