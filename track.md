# AgentLogin isolated login worker — execution tracker

**Last updated:** 2026-11-10  
**Repository:** `zester4/agentlogin`  
**Production environment:** Railway `AgentLogin / production`  
**Purpose:** Keep an auditable, current record of the isolated Playwright login worker hardening, why each control exists, what is verified, and what remains before production activation.

> **Safety rule:** Do not enable the production API worker route or credential enrollment until every production gate below is evidenced. Never place passwords, API keys, signing keys, cookies, lease tokens, plaintext credentials, or DEKs in this file, Git, issues, or logs.

## 1. Objective and architecture

The API remains the policy authority: it validates tenant/agent grants, issues and consumes one-time execution leases, and writes audit events. The isolated login worker performs only the approved browser login operation. It must not become an alternate policy authority or gain broad database access.

The worker needs:
- Private API-to-worker and worker-to-API communication only.
- A distinct AWS identity with narrowly scoped KMS decrypt permission for website-login envelope keys.
- A dedicated non-owner PostgreSQL role with read-only access to only the encrypted credential envelope and connected-account status, with tenant RLS enforced.
- Synthetic HTTPS end-to-end tests and negative tests proving fail-closed behavior.
- Safe telemetry, evidence retention, and a tested rollback.

MFA challenge handling/resume is a separate feature and remains a release blocker for workflows that require MFA.

## 2. Completed work

- [x] **Merged PR #100 — isolated worker production hardening.** Merge commit: `28b68e801d57d55a65c89cfaa015a91a6503ccf1`. PR: https://github.com/zester4/agentlogin/pull/100
  - Why: land the shared code and operational acceptance requirements before changing production permissions or enabling execution.
- [x] **Added bounded PostgreSQL application identity configuration** in `packages/database/src/client.ts`.
  - `DATABASE_APPLICATION_NAME` defaults to `agentlogin-api`, trims whitespace, and accepts only 1–63 safe ASCII characters.
  - Why: distinguish API connections from isolated-worker connections in database observability without changing permissions.
- [x] **Added resolver unit tests** in `packages/database/src/client.test.ts` for default, custom, and invalid values.
  - Why: prevent malformed application names and preserve the existing API default.
- [x] **Documented environment configuration** in `.env.example`, including the per-service database application name and the API/worker URL gating behavior.
- [x] **Added production acceptance runbook** at `docs/ISOLATED_LOGIN_WORKER_PRODUCTION_ACCEPTANCE.md`.
  - Covers private networking, signing-key parity without revealing the key, KMS decrypt-only policy, database role/column grants, RLS, synthetic login fixture, negative cases, evidence, and rollback.
- [x] **Secret scan passed on PR #100** (GitGuardian reported no secrets in the five commits).
- [x] **Verified PR #100 is merged** into `main`; merge commit recorded above.

## 3. Current deployment snapshot

Last checked on 2026-11-10 after the merge:
- Railway production environment contains five services: API, isolated login worker, web, webhook worker, and MCP.
- Webhook worker and MCP were online with successful deployments.
- API, isolated login worker, and web were deploying/building from the merged change at the time of the check.
- No failed deployments or active Railway warnings/criticals were reported in that snapshot.

This is a point-in-time observation, not a claim that the in-progress deployments subsequently succeeded. Recheck Railway before treating them as live.

## 4. Production gates — outstanding

- [ ] **Confirm merged-commit CI.** Inspect GitHub Actions and required checks for the merge commit. The PR description had no GitHub Actions test result at merge time; do not mark tests passing until a successful run is visible.
- [ ] **Confirm production deployments settled.** Verify API, isolated worker, and web deployments reach SUCCESS and inspect logs for startup/configuration errors.
- [ ] **Verify current Railway private domains and ports.** Do not assume hostnames from old notes. Confirm both services share the production environment and use private `.railway.internal` addresses. API-to-worker health only; no execution request yet.
- [ ] **Verify worker ticket signing-key parity safely.** Compare keyed digests in a trusted operator environment. Never read or print the key into chat, Git, or logs.
- [ ] **Provision/verify a distinct AWS worker identity.** Only `kms:Decrypt` on the AgentLogin vault key, constrained by encryption context `purpose=website_login`; verify the KMS key policy also permits it. Test positive and negative permissions using synthetic envelope data and review CloudTrail evidence.
- [ ] **Verify dedicated PostgreSQL role `agentlogin_worker`.** It must be non-owner, non-superuser, `NOBYPASSRLS`, and have only required column-level SELECT on credential envelope fields plus `connected_accounts(id, tenant_id, status)`. No grants/leases/audit/approval access and no write privileges.
- [ ] **Verify RLS under the actual worker role.** Use two synthetic tenants in a disposable database; prove tenant isolation, no-context returns no rows, and write/unauthorized table access is denied.
- [ ] **Set per-service database application names** only after confirming the actual worker service configuration: API `agentlogin-api`, worker `agentlogin-login-worker`.
- [ ] **Run worker-only invalid-ticket tests.** Expect 401/400 and prove the browser is not launched.
- [ ] **Run synthetic HTTPS end-to-end login** in a controlled non-production environment after all preceding gates pass. Use synthetic tenant/grant/account/credential only.
- [ ] **Run negative tests:** wrong tenant/agent/origin, expired and replayed tickets/leases, revoked lease, invalid password, MFA challenge, cross-origin redirect, private/metadata IP, KMS denial, DB denial, timeout, and worker shutdown.
- [ ] **Review safe audit evidence and telemetry.** No credentials, cookies, tokens, plaintext, DEKs, or browser storage state.
- [ ] **Test rollback.** Removing the API worker URL must restore the execution route to disabled.
- [ ] **Only after all sign-offs:** enable the API's private worker URL in a controlled rollout. Keep credential enrollment disabled unless separately authorized and reviewed.

## 5. Configuration contract (verify before use)

The runbook records these expected service names:
- API private host: `agentlogin-api.railway.internal`
- Worker private host: `agentlogin-worker.railway.internal`
- API variable: `AGENTLOGIN_WORKER_URL=http://agentlogin-worker.railway.internal`
- Worker variable: `AGENTLOGIN_API_INTERNAL_URL=http://agentlogin-api.railway.internal`

These are documented expectations, **not currently verified live values**. Confirm Railway's current private domains and ports before configuring anything. Keep `AGENTLOGIN_WORKER_URL` unset until the gates above pass.

## 6. Working rules

1. Update this file whenever a task is completed, failed, or newly blocked; include evidence and date.
2. Never mark a task done based on intention, a staged change, or an in-progress deployment.
3. Prefer synthetic data and non-production acceptance tests.
4. Do not expose or copy secrets into this repository.
5. Keep the API as the authorization/audit authority; keep the worker least-privileged.
6. If a gate cannot be verified with available access, leave it unchecked and state exactly what access/evidence is missing.

## 7. Next actions

Continue in this order: verify merged commit CI → verify deployments/logs → inspect Railway private domains and variable names (never print secret values) → inspect Neon roles/schema/RLS → provision only missing DB permissions through a safe, reviewed migration or DBA process → verify AWS identity/KMS policy → run synthetic tests → consider controlled activation. Do not skip ahead to production activation.
