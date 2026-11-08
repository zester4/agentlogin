# @agentlogin/sdk

Server-side TypeScript SDK for AgentLogin.

AgentLogin lets agents request narrowly scoped access to user-connected accounts without exposing passwords, API tokens, cookies, recovery codes, or session secrets to the agent.

## Install

```bash
npm install @agentlogin/sdk
```

## Quick start

```ts
import { AgentLoginClient } from "@agentlogin/sdk";

const client = new AgentLoginClient({
  baseUrl: process.env.AGENTLOGIN_API_URL!,
  tokenProvider: async () => process.env.AGENTLOGIN_AGENT_TOKEN!
});

const identity = await client.getAgentIdentity();

const request = await client.requestGrant(process.env.AGENTLOGIN_USER_ID!, {
  account_id: process.env.AGENTLOGIN_CONNECTED_ACCOUNT_ID!,
  origin: "https://example.com",
  scopes: ["autofill_login"],
  task_id: "task-123",
  requested_ttl_seconds: 300
});

console.log(identity.principal.agent_id, request.status);
```

The token provider runs for each request, so a trusted server-side host can retrieve a rotated agent credential from its own secret manager. Never put an agent token in browser JavaScript, source control, logs, or user-visible output.

## Client methods

- `getAgentIdentity()` — authenticated agent identity metadata.
- `requestGrant(userId, input)` — request a short-lived, scoped grant; the owner approval flow remains authoritative.
- `getGrantStatus(grantId)` — read status for a grant owned by the authenticated agent.

## Reliability and errors

- Configurable request timeout and bounded retries for safe GET requests.
- Grant mutations are not automatically retried.
- Typed errors: `AgentLoginAuthenticationError`, `AgentLoginPermissionError`, `AgentLoginRateLimitError`, `AgentLoginValidationError`, and `AgentLoginApiError`.
- Inputs and responses are validated with shared Zod contracts.

## Security boundary

This is a server-side/agent-runtime SDK. It does not retrieve credentials, cookies, browser sessions, or raw tokens. A grant is a scoped authorization reference, not a credential or blanket permission. AgentLogin revalidates tenant, agent, account, origin, scope, approval, expiry, and revocation server-side.

## Compatibility

- Node.js 22+
- ESM package
- API base URL must be HTTPS in production.

See the [SDK/MCP guide](https://github.com/zester4/agentlogin/blob/main/docs/SDK_MCP.md) and [security model](https://github.com/zester4/agentlogin/blob/main/docs/SECURITY.md).
