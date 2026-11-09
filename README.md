# AgentLogin

AgentLogin is agent-first identity, authorization, and credential-execution infrastructure. It lets an agent request narrowly scoped access to a user's connected account while keeping passwords, tokens, cookies, recovery material, and session secrets inside AgentLogin's trusted boundary.

**Agents receive short-lived grants and sanitized results, never raw credentials.**

**Author:** Seyyid Annan · [Authors](./AUTHORS.md)

## Repository status

AgentLogin is under active development. The repository now contains a TypeScript monorepo with:

- Neon PostgreSQL + Drizzle persistence, tenant-scoped repositories, and forced row-level security.
- OIDC user authentication and membership/onboarding code paths, plus separate signed agent credentials.
- AES-256-GCM credential-envelope encryption, durable encrypted credential records, and an AWS KMS Encrypt/Decrypt provider used by the account enrollment and credential-rotation API routes.
- Persistent grant and approval workflows, scoped delegation checks, and secret-free audit events.
- A Next.js 16 dashboard with connected-account and approval views, plus a Fastify API.

**This is not yet a production-ready credential vault or login service.** Railway KMS configuration is in place, and the synthetic Neon + KMS vault lifecycle test passed all 8 checks; temporary test data and diagnostic variables were removed. Auth0 organization-claim configuration and the deployed user onboarding/API flow still need end-to-end verification. Secure user-facing enrollment, isolated browser execution, MFA/CAPTCHA handoff, authenticated MCP smoke tests, npm package release checks, and independent security review remain release gates. The durable webhook schema and worker foundation are deployed, but endpoint-management APIs, dashboard SSE synchronization, and end-to-end delivery/security tests remain incomplete; the worker is disabled. Do not submit real credentials or connect real accounts until the production credential gate in [implementation status](./docs/IMPLEMENTATION_STATUS.md) is satisfied.

See [implementation status](./docs/IMPLEMENTATION_STATUS.md) for the implemented foundations, [SDK and MCP guide](./docs/SDK_MCP.md) for developer integrations, [SDK release readiness](./docs/SDK_RELEASE.md) for npm publishing, [webhook architecture](./docs/WEBHOOKS.md) for event delivery and synchronization, [remaining work tracker](./docs/REMAINING_WORK.md) for the active checklist, and [plans](./plans.md) for the longer-term roadmap.

## Repository layout

- `apps/api` — Fastify API, OIDC and agent authentication, connected-account, grant, approval, onboarding, and health routes
- `apps/web` — Next.js 16 user dashboard and developer-facing pages
- `apps/mcp` — Streamable HTTP MCP server with authenticated identity and access-request tools; login execution is intentionally not exposed until its browser worker and API lifecycle are ready
- `packages/contracts` — shared schemas and public types
- `packages/identity` — opaque agent credential issuance and authentication primitives
- `packages/policy` — fail-closed grant authorization and approval lifecycle
- `packages/vault` — AES-GCM envelope encryption and AWS KMS key wrapping provider
- `packages/database` — Neon Postgres + Drizzle schema, repositories, tenant transaction context, and RLS support
- `packages/execution` — provider-neutral execution contracts and coordinator; not a production browser worker
- `packages/sdk` — typed TypeScript client for agent identity, user-approved grant requests, and grant-status lookup
- `db/migrations` — generated Drizzle SQL migrations and metadata
- `db/legacy-migrations` — original SQL bootstrap history, retained for audit only

## Quick start

Requirements: Node.js 22+, pnpm 10+, Docker.

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev
```

API liveness: http://localhost:4000/health. Readiness intentionally remains unavailable until the required persistence and security dependencies are configured.

For local web development, configure the Auth0 values in `apps/web/.env.example` in `apps/web/.env.local`. For the API, configure the OIDC, database, agent-signing, and (when testing credential encryption) AWS KMS values in the root `.env`. Never commit secrets.

## Database workflow

Set `DATABASE_URL` to the pooled Neon URL for application traffic and `DATABASE_URL_UNPOOLED` to the direct (non-pooler) URL for migrations. Never commit either value.

```bash
pnpm db:generate
# Review and commit generated SQL + db/migrations/meta snapshots.
pnpm db:migrate
```

The TypeScript schema in `packages/database/src/schema.ts` is canonical. Do not use drizzle-kit push against production. See [docs/DATABASE.md](./docs/DATABASE.md).

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## SDK and MCP

The SDK and MCP implementation status, supported operations, authentication setup, and examples are documented in [docs/SDK_MCP.md](./docs/SDK_MCP.md). The current MCP server exposes identity inspection and user-approved access requests only. It does not expose passwords, cookies, token retrieval, or browser execution.

## Security boundary

- Grant IDs are references, not standalone authorization.
- Every operation must validate tenant, user, authenticated agent, account, exact origin, scope, expiry, approval, policy, and revocation server-side.
- The API and dashboard must never expose credential values, cookies, tokens, browser profiles, CDP, or raw secret-bearing traces to agents or browser JavaScript.
- Credential enrollment and rotation use the encrypted vault and AWS KMS provider; production KMS credentials and end-to-end verification are still required.
- Decryption is callback-scoped and temporary. JavaScript memory clearing is best-effort and does not guarantee erasure of every copy.
- Browser execution must be isolated and provider-neutral. MFA/CAPTCHA are user handoff states, never bypass targets.
- Login permission does not imply permission to perform arbitrary post-login actions.
- AgentLogin is independent: no Chusky code, browser, infrastructure, branding, or integration.

## Architecture and contribution

Read [AGENT.md](./AGENT.md), [plans.md](./plans.md), [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), [docs/SECURITY.md](./docs/SECURITY.md), [docs/DATABASE.md](./docs/DATABASE.md), [CONTRIBUTING.md](./CONTRIBUTING.md), and the [architecture decision records](./docs/adr/).

Licensed under [Apache License 2.0](./LICENSE). Copyright 2026 Seyyid Annan.


## User dashboard management APIs

The authenticated dashboard uses the following user-scoped endpoints:

- `GET /v1/agents` lists agents in the caller's active developer workspaces. It returns identity and lifecycle metadata only; agent tokens are never returned.
- `POST /v1/developers/:developerId/agents` registers an agent and returns its opaque agent credential once. Store that token in your own secret manager.
- `POST /v1/agents/:agentId/suspend` suspends an agent for an authorized developer owner/admin and revokes its active agent credentials.
- `GET /v1/grants` lists grants owned by the authenticated user, including approval, expiry and revocation metadata.
- `GET /v1/activity` lists audit events created by the authenticated user or associated with grants owned by that user. Secret-bearing event metadata is not returned.
- `POST /v1/grants/:grantId/revoke` revokes a grant owned by the authenticated user.

The dashboard never displays stored website passwords or credential ciphertext. Credential enrollment remains locked until the production security release gates have been completed and an operator explicitly enables it.
