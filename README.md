# AgentLogin

AgentLogin is agent-first identity, authorization, and credential-execution infrastructure. It lets an agent request narrowly scoped access to a user's connected account while keeping passwords, tokens, cookies, and recovery material inside AgentLogin's trusted boundary.

**Agents receive grants and sanitized results, never raw credentials.**

## Repository status

This branch establishes the initial TypeScript monorepo and security-oriented module boundaries. It is a scaffold, not a production-ready credential vault or login service. Credential encryption, identity, policy persistence, approval UX and browser execution require reviewed implementations before real credentials are accepted.

## Workspace

- `apps/api` — HTTP API and health/readiness surface
- `apps/web` — user control-plane shell
- `apps/mcp` — MCP adapter boundary
- `packages/contracts` — shared schemas and public types
- `packages/policy` — fail-closed authorization primitives
- `packages/vault` — encryption/key-management interfaces; no fake crypto
- `packages/execution` — provider-neutral isolated execution contracts
- `packages/sdk` — agent/developer TypeScript client
- `db/migrations` — tenant-scoped relational model foundation

## Quick start

Requirements: Node.js 22+, pnpm 10+, Docker.

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm dev
```

API liveness: `http://localhost:4000/health`. Readiness intentionally returns 503 until persistence and security dependencies are configured.

## Commands

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Security boundary

- Grant IDs are references, not standalone authorization.
- Every operation must validate tenant, user, authenticated agent, account, exact origin, scope, expiry, approval and revocation server-side.
- The API must not expose credential values, cookies, tokens, browser profiles, CDP or raw secret-bearing traces.
- Browser execution must be isolated and provider-neutral.
- MFA/CAPTCHA are user handoff states, never bypass targets.
- AgentLogin is independent: no Chusky code, browser, infrastructure or integration.

See [AGENT.md](./AGENT.md), [plans.md](./plans.md), [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and [docs/SECURITY.md](./docs/SECURITY.md). Do not use real credentials until the vault, identity, authorization and execution controls have been implemented and independently reviewed.
