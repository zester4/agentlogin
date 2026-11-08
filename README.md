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

**This is not yet a production-ready credential vault or login service.** The KMS key and least-privilege AWS identity still need to be configured on Railway, and the live KMS path must pass end-to-end and negative-path verification. Auth0 organization-claim configuration and the deployed user onboarding/API flow also need verification. The secure user-facing enrollment flow, isolated browser worker, MFA/CAPTCHA handoff, complete SDK/MCP transports, and independent security review remain release gates. Do not submit real credentials or connect real accounts until the production credential gate in [implementation status](./docs/IMPLEMENTATION_STATUS.md) is satisfied.

See [implementation status](./docs/IMPLEMENTATION_STATUS.md) for the implemented foundations, [remaining work tracker](./docs/REMAINING_WORK.md) for the active checklist, and [plans](./plans.md) for the longer-term roadmap.

## Repository layout

- `apps/api` — Fastify API, OIDC and agent authentication, connected-account, grant, approval, onboarding, and health routes
- `apps/web` — Next.js 16 user dashboard and developer-facing pages
- `apps/mcp` — MCP boundary; transport and tools are not yet complete
- `packages/contracts` — shared schemas and public types
- `packages/identity` — opaque agent credential issuance and authentication primitives
- `packages/policy` — fail-closed grant authorization and approval lifecycle
- `packages/vault` — AES-GCM envelope encryption and AWS KMS key wrapping provider
- `packages/database` — Neon Postgres + Drizzle schema, repositories, tenant transaction context, and RLS support
- `packages/execution` — provider-neutral execution contracts and coordinator; not a production browser worker
- `packages/sdk` — TypeScript client package; complete authenticated integration is still in progress
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
