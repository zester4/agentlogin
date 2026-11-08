# AgentLogin

AgentLogin is agent-first identity, authorization, and credential-execution infrastructure. It lets an agent request narrowly scoped access to a user's connected account while keeping passwords, tokens, cookies, and recovery material inside AgentLogin's trusted boundary.

**Agents receive grants and sanitized results, never raw credentials.**

## Repository status

This branch now contains an initial identity and tenant-isolation implementation: OIDC user-token verification, developer API-key authentication, scoped per-agent credentials, PostgreSQL persistence, tenant row-level security, and credential rotation/revocation. This is still an implementation milestone, not a production-ready credential vault or login service.

The repository does not yet implement credential encryption/decryption, account enrollment, grant issuance/validation routes, approval workflows, or isolated browser execution. Do not submit production credentials or connect real accounts.

## Workspace

- `apps/api` — Fastify API, identity authentication and tenant-scoped persistence
- `apps/web` — Next.js control-plane shell
- `apps/mcp` — MCP adapter boundary; authenticated transport is not implemented
- `packages/contracts` — shared schemas and public types
- `packages/policy` — fail-closed grant authorization primitive
- `packages/vault` — encryption/key-management interfaces only
- `packages/execution` — isolated execution contracts only
- `packages/sdk` — TypeScript client scaffold
- `db/migrations` — PostgreSQL schema, identity credentials and RLS policies

## Quick start

Requirements: Node.js 22+, pnpm 10+, Docker, PostgreSQL. The local Compose setup creates a separate non-superuser `agentlogin_app` runtime role and an administrative migration role.

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm db:migrate
pnpm dev
```

API liveness: `http://localhost:4000/health`.

`DATABASE_URL` is the API runtime connection and must use the non-superuser runtime role. `MIGRATION_DATABASE_URL` is a separate schema-owner connection, and `AGENTLOGIN_DB_RUNTIME_ROLE` names the runtime role. The migration runner refuses a superuser/`BYPASSRLS` runtime role or a shared migration/runtime role.

Identity readiness: `http://localhost:4000/identity/ready` checks the database, applied identity migration, forced RLS policies, and that the runtime role is not a superuser or `BYPASSRLS`. The identity route plugin performs the same check at startup; authentication, provisioning and bootstrap routes remain `503` if it fails and require an API restart after the database or role is repaired. Full API readiness intentionally remains `503` at `/ready` until the vault, grant, approval, and execution dependencies exist.

## Identity configuration

The user identity adapter accepts externally issued OIDC access tokens signed with RS256. Configure the exact issuer, API audience, and a public RSA JWKS in the environment:

- `OIDC_ISSUER`
- `OIDC_AUDIENCE`
- `OIDC_JWKS_JSON`

The signed token must contain a `tenant_id` claim in AgentLogin's `ten_<uuid>` format. AgentLogin verifies issuer, audience, signature, expiry, not-before and subject, then confirms the issuer/subject membership in that tenant in PostgreSQL. The JWKS is static configuration in this bounded adapter; rotate keys by updating the configured public JWKS and redeploying. No identity vendor has been selected.

An operator provisions a tenant and its first owner/developer with `POST /v1/bootstrap/tenants`, protected by `AGENTLOGIN_BOOTSTRAP_SECRET`. The operator supplies the exact OIDC issuer and owner subject from the trusted identity-provider administration process. This is a privileged bootstrap operation, not public self-service signup.

A verified tenant owner/admin can create additional developer projects with `POST /v1/developers`. The user JWT determines tenant and user context; request bodies cannot choose a tenant.

## Developer and agent credentials

- Developer API keys and per-agent credentials are 256-bit random secrets. Only SHA-256 hashes are stored.
- Credentials are scoped, expire by default after 30 days, and have a hard 90-day maximum.
- Developer credentials are bound to tenant + developer. Agent credentials are bound to tenant + developer + exact agent, with a composite database foreign key.
- Rotation inserts the replacement and revokes the previous credential in one PostgreSQL transaction. Revocation and expiry are checked on every authenticated request.
- Tenant-owned tables use PostgreSQL RLS with transaction-local `app.tenant_id`; service queries also include explicit tenant and owner predicates.
- The database runtime role must not be a superuser or have `BYPASSRLS`.

Current routes:

- `GET /v1/user/me` — verified OIDC user identity and tenant membership
- `POST /v1/developers` — owner/admin creates a developer key
- `GET /v1/developer/me` — developer credential identity
- `POST /v1/agents` — create an agent under the authenticated developer
- `GET /v1/agents` and `GET /v1/agents/:agentId` — tenant/developer-scoped agent metadata
- `POST /v1/agents/:agentId/credentials` — issue an `agent:read` credential
- `POST /v1/agents/:agentId/credentials/:credentialId/rotate` and `/revoke`
- `POST /v1/developer-keys/:credentialId/rotate` and `/revoke`
- `GET /v1/agent/me` — authenticated agent identity only

Raw developer/agent credentials are returned once to the authenticated developer or operator that provisions them, with no-store response headers. Store them only in a trusted developer backend/secret manager. Never forward them to an LLM, prompt, agent-visible tool result, log, analytics, or support transcript. If the agent is an LLM, the developer's trusted runtime must hold the credential and proxy the AgentLogin call.

The token identifiers in a presented credential are untrusted lookup selectors only. AgentLogin creates a principal from the tenant-scoped database row only after verifying the secret hash and active status. A credential ID by itself is not authentication.

## Security boundary

- Grant IDs are references, not standalone authorization.
- Every operation must validate tenant, user, authenticated agent, connected account, exact origin, scope, expiry, policy version, approval and execution context.
- The API must not expose credential values, cookies, tokens, browser profiles, CDP or raw secret-bearing traces.
- Browser execution must be isolated and provider-neutral.
- MFA/CAPTCHA are user handoff states, never bypass targets.
- AgentLogin is independent: no Chusky code, browser, infrastructure or integration.

See [AGENT.md](./AGENT.md), [plans.md](./plans.md), [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), [docs/SECURITY.md](./docs/SECURITY.md), and [ADR 0005](./docs/adr/0005-identity-and-workload-credentials.md).

## Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate
```
