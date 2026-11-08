# Architecture

## Trust boundaries

1. Control plane: user authentication, connected accounts, delegation, approvals, audit and revocation.
2. Developer API: authenticates developer projects and manages agent identities and credentials.
3. Agent API: authenticates one registered agent under one developer and tenant; exposes task-level operations only.
4. Authorization: evaluates tenant, user, agent, account, exact origin, scope, policy, approval, expiry and revocation for every operation.
5. Vault: encrypted storage and callback-scoped decryption for approved execution identities only.
6. Execution workers: isolated website login and provider connectors; no shared profiles or secret-bearing artifacts with agents.
7. Adapters: provider-neutral OIDC/JWKS, database, KMS, browser, OAuth, notification and storage interfaces.

## Identity flow

User identity uses a bounded OIDC access-token adapter. It accepts RS256 only, verifies the configured exact issuer and API audience against a configured public RSA JWKS, checks expiry/not-before/issued-at/subject, and requires a signed `tenant_id` claim. AgentLogin then confirms the exact issuer/subject membership and active user/tenant status in PostgreSQL. No identity provider is selected or bundled. The current JWKS adapter uses static configuration; key rotation requires updating the public JWKS configuration and redeploying.

A privileged operator bootstraps a tenant, owner membership, developer project, and initial developer API key through `POST /v1/bootstrap/tenants`. The bootstrap endpoint is disabled unless `AGENTLOGIN_BOOTSTRAP_SECRET` is configured. Its owner issuer must exactly match the configured OIDC issuer. Additional developer projects are created by an authenticated tenant owner/admin.

Developer API keys and per-agent credentials use 256-bit random secrets. The database stores only SHA-256 hashes, scopes, expiry, revocation and last-use metadata. The credential's embedded tenant/developer/agent identifiers are lookup selectors only. They are not trusted claims: the API loads the exact tenant-scoped row, verifies the secret hash in constant time, confirms current tenant/developer/agent status and only then creates the authenticated principal.

Agent credentials are composite-bound to `(tenant_id, developer_id, agent_id)`. PostgreSQL enforces that the credential's developer owns the referenced agent. Developer routes query by authenticated `tenant_id` and `developer_id`; agent routes use the tenant, developer, agent and credential identifiers established by the authenticated row. Request-body tenant IDs are rejected by strict schemas and are never used to establish identity.

Raw credentials are returned only in one-time provisioning/rotation responses to an authenticated developer or operator. They are not returned by identity inspection routes. A developer integration must keep them in its trusted backend and must never forward them to an LLM, prompt, tool output, log, or agent-visible transcript.

## Tenant isolation

Every tenant-owned table has PostgreSQL row-level security enabled and forced. Each tenant-scoped repository operation runs in a transaction and sets transaction-local `app.tenant_id`; every SQL query also includes explicit tenant and ownership predicates. Composite foreign keys prevent a credential or account relation from crossing tenant/developer ownership boundaries.

The database runtime role must not be a superuser and must not have `BYPASSRLS`. Local Compose creates `agentlogin_app` separately from the migration administrator; `DATABASE_URL` must use the former and `MIGRATION_DATABASE_URL` the latter. RLS is defense in depth: it does not protect against a compromised application role that can deliberately set another tenant context. Application authorization and explicit query predicates remain mandatory. Authentication lookup uses only the identifiers in the presented credential to narrow a tenant-scoped lookup; the resulting principal is not trusted until the secret hash and active database state are verified.

At API startup, the identity route plugin runs the identity readiness check before enabling authentication, developer provisioning, or operator bootstrap. If the identity migration, forced RLS policies, or non-superuser runtime-role check fails, those routes remain unavailable (503) until the API is restarted after remediation. The liveness endpoint remains separate from identity readiness.

## Credential lifecycle

Developer and agent credentials expire after 30 days by default, with a 90-day maximum. Rotation inserts a new credential and revokes the old one in the same transaction. Revocation, expiry and active tenant/developer/agent status are rechecked on every request. The old secret is never recoverable because only its one-way hash is persisted.

The current agent scope is deliberately limited to `agent:read`. No grant-request, execution, account, or credential-retrieval capability is exposed to an agent yet.

## Flow

```text
Operator -> tenant bootstrap -> OIDC owner membership + developer key
Developer backend -> register agent -> issue scoped agent credential
Agent runtime -> authenticated AgentLogin API -> tenant/agent ownership checks
Agent <- safe identity metadata and later allowlisted operation results
```

The future credential-execution flow remains:

```text
Agent -> authenticated API -> grant request -> policy/delegation -> user approval
Agent -> login operation -> fresh grant validation -> isolated worker -> vault + target site
Agent <- allowlisted sanitized result <- execution/audit
```

Tenant context must come from verified authentication, never request-body fields. Grant IDs are not bearer authorization. Origin checks use parsed normalized scheme/host/effective port and exact equality. Decryption is absent from API and MCP processes.

## Runtime and key-custody direction

The current repository uses a Node.js/Fastify API and PostgreSQL. The API is the recommended control-plane runtime; PostgreSQL is the authoritative identity store for this milestone. Cloudflare Workers are not selected for the core API, vault, or browser execution. A Worker may be evaluated later as optional edge ingress only, with authorization remaining authoritative in the Node API.

The vault and execution packages are interfaces, not implementations. No KMS provider, encryption implementation, browser provider, or production hosting provider has been selected. Decryption must remain outside API and MCP processes.

See [ADR 0002](./adr/0002-cloudflare-workers-placement.md), [ADR 0003](./adr/0003-key-custody-and-envelope-encryption.md), [ADR 0004](./adr/0004-cryptography-runtime.md), and [ADR 0005](./adr/0005-identity-and-workload-credentials.md).
