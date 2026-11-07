# Contributing to AgentLogin

Thank you for helping improve AgentLogin. This project protects user credentials while allowing agents to request narrowly scoped access. Security and correctness take priority over feature speed.

## Project principles

- Agents receive short-lived grants and sanitized results, never raw passwords, tokens, cookies, recovery codes or session secrets.
- Every operation must be authorized against verified tenant, user, authenticated agent, connected account, exact origin, scope, expiry, policy, approval and revocation state.
- A grant ID is not a bearer credential and does not authorize arbitrary post-login actions.
- Fail closed when identity, policy, origin, key custody, audit or execution state is uncertain.
- Never bypass MFA, CAPTCHA, bot defenses or user-presence checks.
- AgentLogin is independent. Do not add Chusky dependencies or assume access to another product's browser or infrastructure.

## Before opening a pull request

1. Read [AGENT.md](./AGENT.md), [plans.md](./plans.md) and [SECURITY.md](./SECURITY.md).
2. Search for an existing issue or open one describing the proposed change.
3. For architectural or security-sensitive changes, include the threat, trust boundary, alternatives and residual risk.
4. Keep pull requests focused and reviewable.
5. Add tests for both allowed and denied paths. Prefer synthetic credentials and deterministic fixtures.
6. Update documentation and milestone status only when backed by implementation and test evidence.

## Local development

Requirements: Node.js 22+, pnpm 10+ and Docker for local PostgreSQL.

~~~bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev
~~~

## Required checks

Run the checks relevant to your changes before submitting:

~~~bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
~~~

Do not mark a check as passing if it was not run. Include the exact command and result in the pull request.

## Security-sensitive changes

- Never commit real credentials, API keys, access tokens, cookies, private keys, customer data or production logs.
- Never add a public method that returns decrypted credentials to an agent-facing caller.
- Do not log request bodies, authorization headers, cookies, credential payloads or raw browser traces.
- Bind encryption to tenant, credential, record version and purpose using authenticated associated data.
- Use a managed KMS or explicitly reviewed key provider for wrapping data-encryption keys. Do not ship a hard-coded master key or environment-wide static DEK.
- Add negative tests for cross-tenant access, wrong-agent use, wrong origin, missing scope, expiry, revocation, replay and secret leakage as applicable.
- Database code must use verified identity context and tenant-scoped transactions. Runtime roles must not own protected tables or bypass row-level security.
- Treat web pages and browser content as untrusted input. Do not let page instructions modify authorization policy.

Report suspected vulnerabilities privately. Do not include exploit details or secrets in public issues.

## Pull request checklist

- [ ] Scope and threat model are explained.
- [ ] Tests cover success, denial and relevant abuse cases.
- [ ] No secret material is present in code, fixtures, logs, snapshots or error messages.
- [ ] Tenant and agent boundaries are enforced server-side.
- [ ] Documentation and plans reflect actual implementation status.
- [ ] All relevant checks were run and results are reported.
- [ ] No production-readiness claim is made without evidence and review.
