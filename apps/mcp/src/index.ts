import { AgentIdentitySchema, type GrantRequest } from "@agentlogin/contracts";
import { AgentLoginClient } from "@agentlogin/sdk";
import { createMcpHandler, McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

export type AgentLoginMcpOptions = {
  apiBaseUrl: string;
  fetch?: typeof fetch;
};

export function createAgentLoginMcpHandler(options: AgentLoginMcpOptions) {
  const apiBaseUrl = new URL(options.apiBaseUrl);
  if (!["https:", "http:"].includes(apiBaseUrl.protocol) || apiBaseUrl.username || apiBaseUrl.password) {
    throw new TypeError("apiBaseUrl must be an HTTP(S) URL.");
  }
  const fetcher = options.fetch ?? fetch;

  return createMcpHandler(({ authInfo }) => {
    const server = new McpServer({ name: "agentlogin", version: "0.2.0" });
    const token = authInfo?.token;
    const clientId = authInfo?.clientId;
    if (!token || !clientId) {
      throw new Error("An authenticated AgentLogin agent is required.");
    }
    const client = new AgentLoginClient({ baseUrl: apiBaseUrl.toString(), agentToken: token, fetch: fetcher });

    server.registerTool(
      "agentlogin_get_identity",
      {
        title: "Get AgentLogin identity",
        description: "Return the authenticated AgentLogin agent and developer identifiers. Does not reveal credentials or account secrets.",
        outputSchema: z.object({
          authenticated: z.literal(true),
          agent_id: z.string(),
          developer_id: z.string()
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
      },
      async () => {
        const identity = AgentIdentitySchema.parse(await client.getAgentIdentity());
        return {
          content: [{ type: "text", text: "AgentLogin agent authentication is valid." }],
          structuredContent: {
            authenticated: true as const,
            agent_id: identity.principal.agent_id,
            developer_id: identity.principal.developer_id
          }
        };
      }
    );

    server.registerTool(
      "agentlogin_request_access",
      {
        title: "Request account access",
        description: "Request narrowly scoped login permission for a user-delegated connected account. The request enters the user's approval inbox; this tool cannot approve itself, retrieve passwords, or execute a login.",
        inputSchema: z.object({
          user_id: z.string().min(1).max(200),
          account_id: z.string().min(1).max(200),
          origin: z.string().url(),
          scopes: z.array(z.enum(["autofill_login"])).min(1).max(1),
          task_id: z.string().min(1).max(200).optional(),
          requested_ttl_seconds: z.number().int().min(30).max(900).optional()
        }).strict(),
        outputSchema: z.object({
          status: z.literal("pending_approval"),
          grant_id: z.string(),
          approval_id: z.string(),
          expires_at: z.string()
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
      },
      async (input) => {
        try {
          const request: GrantRequest = {
            account_id: input.account_id,
            origin: input.origin,
            scopes: input.scopes,
            ...(input.task_id ? { task_id: input.task_id } : {}),
            ...(input.requested_ttl_seconds ? { requested_ttl_seconds: input.requested_ttl_seconds } : {})
          };
          const grant = await client.requestGrant(input.user_id, request);
          return {
            content: [{ type: "text", text: "Access request submitted. The account owner must approve it before it can be used." }],
            structuredContent: grant
          };
        } catch (error) {
          const message = error instanceof Error && "status" in error
            ? "AgentLogin could not accept the access request. Check delegation, account ownership, and agent permissions."
            : "AgentLogin is temporarily unavailable. No credentials were disclosed.";
          return { content: [{ type: "text", text: message }], isError: true };
        }
      }
    );

    return server;
  });
}

export { AgentIdentitySchema };
