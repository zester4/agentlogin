# AgentLogin

AgentLogin is agent-first identity, authorization and credential-execution infrastructure. It lets an agent request narrowly scoped access to a user's connected account while keeping passwords, tokens, cookies, recovery material and session secrets inside AgentLogin's trusted boundary.

**Agents receive short-lived grants and sanitized results, never raw credentials.**

**Author:** Seyyid Annan · [Authors](./AUTHORS.md)

## Repository status

AgentLogin is under active development. The repository contains an initial TypeScript monorepo, a tested AES-256-GCM credential-envelope primitive, callback-scoped plaintext access, an opaque agent-token authentication primitive, tenant-scoped database migrations and security regression tests.

This is not a production-ready credential vault or login service. Production KMS, durable repositories, authenticated API middleware, user/developer identity, approval workflows, isolated browser execution and independent security review remain outstanding. Do not submit real credentials or connect real accounts.

See [implementation status](./docs/IMPLEMENTATION_STATUS.md) for implemented foundations and remaining release gates.

## Workspace

- apps/api — Fastify HTTP API and health/readiness surface
- apps/web — user control-plane shell
- apps/mcp — MCP boundary; transport and tools are not yet implemented
- packages/contracts — shared schemas and public types
- packages/identity — opaque agent credential issue/authentication primitives
- packages/policy — fail-closed grant authorization primitives
- packages/vault — AES-GCM envelope encryption and callback-scoped vault boundary
- packages/execution — provider-neutral isolated execution contracts
- packages/sdk — TypeScript client
- db/migrations — PostgreSQL schema, agent credentials and tenant RLS

## Quick start

Requirements: Node.js 22+, pnpm 10+, Docker.

~~~bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev
~~~

API liveness: http://localhost:4000/health. Readiness intentionally returns 503 until persistence and security dependencies are configured.

## Checks

~~~bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
~~~

## Security boundary

- Grant IDs are references, not standalone authorization.
- Every operation must validate tenant, user, authenticated agent, account, exact origin, scope, expiry, approval and revocation server-side.
- The API must not expose credential values, cookies, tokens, browser profiles, CDP or raw secret-bearing traces.
- Decryption is callback-scoped and temporary; production KMS and storage adapters are not yet configured.
- Browser execution must be isolated and provider-neutral.
- MFA/CAPTCHA are user handoff states, never bypass targets.
- AgentLogin is independent: no Chusky code, browser, infrastructure or integration.

## Architecture and contribution

Read [AGENT.md](./AGENT.md), [plans.md](./plans.md), [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), [docs/SECURITY.md](./docs/SECURITY.md), [CONTRIBUTING.md](./CONTRIBUTING.md) and the [architecture decision records](./docs/adr/).

Licensed under [Apache License 2.0](./LICENSE). Copyright 2026 Seyyid Annan.
