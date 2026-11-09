# AgentLogin SDK and MCP integration

This guide describes the first usable developer integration layer. It intentionally exposes only capabilities that are backed by implemented API routes.

## TypeScript SDK

The SDK is split from the API and can be published independently. The shared contracts package is a runtime dependency.

\`\`\`bash
pnpm add @agentlogin/sdk
\`\`\`

Create a client with an agent credential. Prefer a token provider when the calling application rotates or retrieves credentials dynamically:

\`\`\`ts
import { AgentLoginClient } from "@agentlogin/sdk";

const client = new AgentLoginClient({
  baseUrl: process.env.AGENTLOGIN_API_URL!,
  tokenProvider: async () => getAgentLoginCredential()
});

const identity = await client.getAgentIdentity();

const accessRequest = await client.requestGrant(userId, {
  account_id: connectedAccountId,
  origin: "https://example.com",
  scopes: ["autofill_login"],
  task_id: "support-ticket-123",
  requested_ttl_seconds: 300
});

if (accessRequest.status === "pending_approval") {
  console.log("Waiting for the account owner to approve the request.");
}
\`\`\`

### Current SDK methods

| Method | API route | Behavior |
|---|---|---|
| \`getAgentIdentity()\` | \`GET /v1/agent/me\` | Returns authenticated agent, developer, tenant, and credential identifiers. |
| \`requestGrant(userId, input)\` | \`POST /v1/users/:userId/grants\` | Requests a short-lived grant; the current lifecycle queues it for explicit owner approval. |

The SDK validates inputs and responses with shared Zod contracts. It supports a static agent token or a per-request token provider, configurable timeouts, bounded retries for safe GET requests, and typed HTTP errors. Mutating grant requests are not automatically retried because the API does not yet provide idempotency-key replay semantics.

Errors include \`AgentLoginApiError\` and specialized authentication, permission, rate-limit, and validation errors. Do not log tokens or attach them to browser code. Use the SDK from trusted server-side or agent runtime code.

## MCP server

The MCP application uses the official Model Context Protocol TypeScript SDK v2.4.0 server/client packages, the published Node adapter v2.1.2, and the published Fastify adapter v2.0.1 with Streamable HTTP transport.

Start it locally:

\`\`\`bash
AGENTLOGIN_API_URL=http://localhost:4000 \\
MCP_ALLOWED_HOSTS=localhost,127.0.0.1 \\
pnpm dev:mcp
\`\`\`

The endpoint is \`http://localhost:4010/mcp\`.

Configure the MCP host with an AgentLogin agent credential as a bearer token. The MCP service verifies every request by calling \`GET /v1/agent/me\` on the AgentLogin API. It does not implement a second, divergent copy of agent-token validation.

### Exposed MCP tools

| Tool | Purpose | Side effects |
|---|---|---|
| \`agentlogin_get_identity\` | Confirms the authenticated agent and developer identity. | Read-only. |
| \`agentlogin_request_access\` | Requests scoped login permission for a user-delegated account. | Creates a pending approval request. |

\`agentlogin_request_access\` requires a user ID, connected-account ID, exact origin, and scope. The account owner must already have delegated the account and scope to the agent. A grant request is not an approval and does not authorize a login until the owner approves it and the API revalidates all grant bindings.

### Deliberately unavailable tools

The MCP server does **not** expose:

- Password, API-key, cookie, OAuth-token, recovery-code, or session retrieval.
- A tool to approve its own access request.
- Account listing or credential enrollment on behalf of a user.
- \`login_with_grant\`, execution-status polling, or user-action/MFA completion.

Those operations are not yet backed by a complete production login-execution API. AgentLogin is the authorization and account-access product; it does not expose a browser product. An execution provider may be used internally only where a website requires automated form login. Do not add placeholder tools that appear callable but cannot safely complete their advertised action.

## Local synthetic login site

A loopback-only synthetic website is available for deterministic integration tests. It uses disposable test credentials, in-memory sessions, an MFA challenge, and no real customer data. Start it with:

```bash
pnpm --filter @agentlogin/test-site start
```

Open `http://127.0.0.1:4173/login`. Test-only credentials and scenarios are documented in `apps/test-site/README.md`. Run its tests with `pnpm --filter @agentlogin/test-site test`.

This fixture verifies the website's own success, invalid-password, MFA, and logout behavior. **It does not yet prove that AgentLogin's API, SDK, or MCP can perform a login**; the authenticated execution endpoint and provider integration remain to be implemented and tested end-to-end.

## Authentication and transport security

- The MCP HTTP endpoint accepts an AgentLogin opaque agent bearer credential and validates it against the API for every request.
- This is a custom AgentLogin bearer-token integration, **not yet MCP OAuth 2.1 authorization discovery**. Hosts must be configured with the agent credential. Add OAuth 2.1 / RFC 9728 protected-resource metadata and an authorization-code flow before claiming automatic OAuth onboarding for general remote MCP clients.
- Configure \`MCP_ALLOWED_HOSTS\` with the exact public hostname(s) of the MCP service.
- Configure \`MCP_ALLOWED_ORIGINS\` with the exact browser origins allowed to call it. Requests with an Origin header are rejected unless it is explicitly allowlisted. Non-browser clients without Origin are still protected by host validation and agent authentication.
- Use HTTPS in production. Never expose the MCP endpoint without authentication.
- Do not pass credentials or secret-bearing values as MCP tool arguments or results.
- The agent token is sent to the MCP service and then to the API identity endpoint over the configured API connection. Use HTTPS for both services in production.
- The API remains the authority for tenant, developer, agent, credential status, delegation, account, origin, scope, approval, expiry, and revocation checks.

## Package release

\`@agentlogin/sdk\` and \`@agentlogin/contracts\` have public-package metadata and distribution exports prepared. They have not been published to npm. Before publishing, run the workspace CI, verify the packed tarballs and declaration files, confirm npm scope ownership, and publish the contracts package before the SDK.

## Verification checklist

- [ ] GitHub Actions passes lint, typecheck, unit tests, and build for both packages.
- [ ] Run the SDK against the deployed API with a dedicated test agent credential.
- [ ] Run the MCP client integration test against the real Streamable HTTP endpoint.
- [ ] Verify missing, malformed, expired, revoked, and cross-tenant agent credentials are rejected.
- [ ] Verify invalid Host and Origin requests are rejected.
- [ ] Verify delegated and non-delegated grant requests behave correctly.
- [ ] Verify all errors and logs redact bearer credentials and never include account secrets.
- [ ] Add OAuth 2.1 discovery and authorization if required by target MCP clients.
- [ ] Deploy the MCP service separately and configure its hostname/origin allowlists; verify live health and authenticated remote MCP behavior.
- [ ] Publish the SDK and contracts only after the release checklist passes.
- [ ] Webhooks are not yet implemented; see [webhook architecture](./WEBHOOKS.md).


## Developer application OAuth (server-side)

Developer workspaces can issue an application credential pair for trusted backend integrations. Create the pair with an authenticated user access token:

```http
POST /v1/developers/{developerId}/applications
Authorization: Bearer <user-access-token>
Content-Type: application/json

{"name":"My agent integration"}
```

The response contains `client_id` and `client_secret`. The secret is displayed once; AgentLogin stores only its SHA-256 hash. Keep both values in a server-side secret manager. Do not expose them in browser JavaScript, an MCP prompt, logs, or source control.

Exchange the credentials using the OAuth 2.0 client-credentials grant:

```http
POST /oauth/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
```

Access tokens are opaque, tenant-bound, database-backed bearer tokens with a 15-minute lifetime. They are currently issued with the `agents:manage` scope. The application token can register an agent; the newly issued agent credential is then used for agent identity and scoped grant requests.

```ts
import { AgentLoginApplicationClient, AgentLoginClient } from "@agentlogin/sdk";

const application = new AgentLoginApplicationClient({
  baseUrl: process.env.AGENTLOGIN_API_URL!,
  clientId: process.env.AGENTLOGIN_CLIENT_ID!,
  clientSecret: process.env.AGENTLOGIN_CLIENT_SECRET!
});

const registered = await application.registerAgent({
  name: "Support agent",
  identity_type: "browser"
});

// Store registered.credential.token in your secret manager.
const agent = new AgentLoginClient({
  baseUrl: process.env.AGENTLOGIN_API_URL!,
  agentToken: registered.credential.token
});

const identity = await agent.getAgentIdentity();
```

The API requires a separate `APPLICATION_TOKEN_SIGNING_KEY` containing 32 random bytes encoded as base64url. Configure it in the API environment before enabling application credential issuance. This key is distinct from `AGENT_TOKEN_SIGNING_KEY`.

This does **not** yet provide MCP OAuth 2.1 authorization discovery, authorization-code login, or browser login execution. The SDK package is still unpublished; follow `docs/SDK_RELEASE.md` before announcing an npm release.
