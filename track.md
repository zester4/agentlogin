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


## 8. Live audit update — 2026-11-10

Additional read-only checks performed after the tracker was committed:

### Railway configuration and deployment
- [x] Confirmed API private endpoint label is `agentlogin-api`; isolated worker private endpoint label is `agentlogin-worker`. Their current private hostnames follow Railway's `.railway.internal` convention. API listens on 8080; worker listens on 4180 according to runtime logs.
- [x] Confirmed the expected variable **names** exist: API has `AGENTLOGIN_WORKER_URL` and `AGENTLOGIN_WORKER_TICKET_SIGNING_KEY`; worker has `AGENTLOGIN_API_INTERNAL_URL` and `AGENTLOGIN_WORKER_TICKET_SIGNING_KEY`.
- [ ] **Do not infer variable values or signing-key parity:** the connected Railway session redacts values. The API's latest startup did not emit the earlier “login execution routes are disabled” warning, so route activation state must be confirmed in a trusted environment. Treat this as an urgent verification gate; do not run a real credential.
- [ ] Worker has no `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` variable names in its current Railway config. `AWS_REGION` and `AWS_KMS_KEY_ID` are present. No workload identity was verified. The API has AWS access-key variable names, but those must not be copied to the worker or reused.
- [ ] Worker does not currently list `DATABASE_APPLICATION_NAME`; configure `agentlogin-login-worker` only after confirming the correct worker DB URL and least-privilege grants.
- [ ] At the latest status poll, API, worker, web, MCP and webhook services had newer deployments queued/building/deploying. Older successful deployments were still present; wait for the new deployment set to settle and inspect each latest deployment.
- [ ] GitHub Actions workflow runs for merge commit `28b68e801d57d55a65c89cfaa015a91a6503ccf1`: none returned. Railway commit statuses were pending for API/worker/web and success for MCP/webhook at the time of the check.

### Neon/PostgreSQL read-only audit
- [x] Confirmed Neon project `agentlogin`, default branch `main`, database schema includes `credentials`, `connected_accounts`, `grants`, and `credential_leases`.
- [x] Confirmed role `agentlogin_worker` exists and can log in; it is not superuser, has `NOBYPASSRLS`, cannot create roles/databases, and has no inherited role memberships.
- [x] Confirmed RLS and FORCE RLS are enabled on `credentials`, `connected_accounts`, `grants`, and `credential_leases`. Policies filter rows using transaction-local `app.tenant_id`.
- [ ] **Worker grants are not yet correct for the documented least-privilege target:** direct role check shows table-level SELECT on all columns of `credentials`, no SELECT on `connected_accounts`, and no SELECT on `grants` or `credential_leases`. The worker can connect and use schema `public`. The table-wide credential SELECT must be replaced with the exact required column-level SELECT, and the worker needs only `connected_accounts(id, tenant_id, status)`. No database grants were changed during this audit.
- [ ] Run a trusted connection test as `agentlogin_worker` after the grants are corrected: no tenant context returns zero rows; tenant A cannot read tenant B; writes and grant/lease reads fail; only the intended credential/account columns are readable.

### Immediate next steps
1. Resolve whether the API worker route is currently enabled, using a trusted config view that can verify variable presence/value without exposing secrets. If enabled before the remaining gates pass, pause execution using the approved operational rollback process.
2. Wait for all current Railway deployments to settle; inspect failures and verify API/worker health.
3. Have the database owner apply the narrow grant correction in a reviewed transaction, then rerun the worker-role privilege checks. Do not widen privileges to make a test pass.
4. Establish a dedicated worker KMS identity; do not copy API AWS credentials.
5. Run synthetic-only worker and end-to-end tests after all prior gates pass.


## 9. Latest CI and implementation update — 2026-11-10

### CI result on latest main before PR #103
- The successful CI run on tracker commit `c8968e853147fa48d238ecc66537e65973ab8709` completed build, migrations, lint, typecheck and tests successfully. That commit contained PR #100's code plus the initial tracker file.
- The later main-branch run for commit `d4ccc69cff59b914797ba71f44c9f49428ab562c` (after PR #101) completed build, migrations, lint and typecheck, but **failed tests**.
- The two principal failures were:
  1. `assertSafeWebhookPayload` rejected `credentials_revoked: true`, even though this is a boolean lifecycle status and not a credential value.
  2. The vault integration test emitted a synthetic webhook event, then its cleanup tried to delete the tenant without first deleting that event, causing a foreign-key violation.
- The original PR #100 merge run was cancelled when a later main push arrived. The tracker commit's subsequent CI run succeeded. The latest main run was rerun and completed with the test failures above.

### Fix opened
- [x] **PR #103 merged:** https://github.com/zester4/agentlogin/pull/103 (merge commit `7f4165fbe348203d944a509df9ddcf70a98a4625`).
- Branch: `fix/webhook-safe-status-and-vault-cleanup`
- It narrowly allows the exact `credentials_revoked` key only when its value is boolean, adds regression tests, and removes the synthetic vault test's webhook event before deleting its tenant.
- No production database, Railway variables, AWS IAM/KMS settings, credential records, or execution-route settings were changed for this fix.
- [x] Main-branch CI passed on commit `4ee621d3a9291f10ebf8842ffb1178ff00293567`: build, migrations, least-privilege CI DB grants, lint, typecheck and tests all completed successfully.

### Confirmed worker database issue
- The worker role can connect, use schema `public`, and is non-superuser with `NOBYPASSRLS` and no inherited role memberships.
- Direct login as `agentlogin_worker` confirms `credentials` table SELECT is currently granted at table level; `connected_accounts` SELECT is absent; grants and lease SELECT are absent.
- A read-only join probe using the worker role failed with `permission denied for table connected_accounts`. This is the exact join used by `PostgresCredentialRecordStore.find`; worker credential lookup will fail until the grants are corrected.
- RLS and FORCE RLS are enabled on both required tables and their tenant policies use `current_setting('app.tenant_id', true)`.
- The least-privilege grant correction is prepared in the runbook but has **not** been applied. It requires an approved database permission change.

### Current production safety status
- Railway lists API `AGENTLOGIN_WORKER_URL` and worker `AGENTLOGIN_API_INTERNAL_URL`, plus the signing-key variable names on both services. Values are redacted by the connected session, so key parity and exact URL values are unverified.
- The latest API startup did not emit the previous “login execution routes are disabled” warning. Therefore, treat production route activation as **possibly enabled** until an authorized operator confirms it safely. Do not send a real credential or attempt production execution.
- Worker config has `AWS_REGION` and `AWS_KMS_KEY_ID`, but no `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` variable names. No Railway-to-AWS workload identity was verified. API AWS credentials must not be copied or reused.
- Worker health checks have returned HTTP 200 on port 4180. This proves process health only, not broker, KMS, database, or login execution.
- The synthetic test site binds only to loopback HTTP. It is not a valid production-mode HTTPS target because the real worker requires public HTTPS DNS and blocks private/loopback targets.
- Real worker MFA completion/resume is not implemented; MFA is reported as a challenge outcome.

### Remaining blockers
- [x] PR #103 merged and main CI passed (run `42861623640`, success).
- [ ] Production route state is confirmed; if enabled before gates pass, use the approved rollback to pause it.
- [ ] Latest Railway deployments settle successfully and logs are reviewed.
- [ ] Dedicated AWS worker identity and KMS positive/negative tests are verified.
- [ ] Database owner approves and applies the exact column-level grants: revoke table-wide SELECT on `credentials`; grant SELECT only on the fields used by `find`; grant SELECT only on `connected_accounts(id, tenant_id, status)`.
- [x] Re-tested the actual credentials-to-connected_accounts join as `agentlogin_worker` with `WHERE false` to validate column privileges without reading any customer rows. RLS remains enabled and forced. [ ] Complete tenant-A/tenant-B row-isolation verification with synthetic tenant fixtures.
- [ ] Deploy a controlled synthetic HTTPS fixture and run the real isolated-worker path with synthetic-only tenant/grant/account/credential data.
- [ ] Test negative tickets, lease replay/expiry/revocation, wrong tenant/agent/origin, invalid password, cross-origin redirects, private/metadata IPs, KMS/DB denial, timeout and shutdown.
- [ ] Decide and implement a secure MFA handoff/resume design if MFA-enabled sites are in scope.

No production execution or credential enrollment is considered accepted until all gates are evidenced.


## 10. Execution update after user approval — 2026-11-10

### Completed in this continuation
- [x] User explicitly approved correcting the isolated worker database permissions.
- [x] PR #103 merged to main; merge commit: `7f4165fbe348203d944a509df9ddcf70a98a4625`.
- [x] Main CI run `42861623640` completed successfully on `4ee621d3a9291f10ebf8842ffb1178ff00293567`. The quality job passed, including build, migrations, test-role grants, lint, typecheck and tests.
- [x] Connected to the AgentLogin Neon main branch using the table-granting migration role `agentlogin_migrator` (the default database connection could not revoke privileges because the existing grants were made by the migrator role).
- [x] Revoked table-level SELECT on `public.credentials` from `agentlogin_worker`.
- [x] Granted column-level SELECT on `credentials(id, tenant_id, account_id, credential_id, credential_type, ciphertext, iv, auth_tag, wrapped_dek, key_version, record_version, status, revoked_at)`.
- [x] Granted column-level SELECT on `connected_accounts(id, tenant_id, status)`.
- [x] Verified no table-level SELECT on either table, no access to `credentials.created_at`, and no SELECT on `grants` or `credential_leases`.
- [x] Verified the actual worker-role join between credentials and connected_accounts executes successfully with `WHERE false`. This proves column privilege correctness without reading customer records.
- [x] Verified RLS and FORCE RLS remain enabled on both tables.
- [ ] Still required: synthetic tenant A/B row-isolation test with no customer data; worker runtime connection test against the production DATABASE_URL.

### Updated Railway observation
- The latest Railway inventory shows API, web and isolated worker still deploying; webhook worker and MCP are online. Do not mark the overall production rollout complete until the current deployments settle and their health is verified.
- The isolated worker variable inventory now includes names `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, along with `AWS_REGION` and `AWS_KMS_KEY_ID`. Variable values are not visible in this OAuth-connected Railway session. **Presence of those variable names does not prove that the credentials belong to a dedicated least-privilege worker IAM identity.** Do not copy or print secret values. Confirm the worker AWS principal with an authorized AWS STS/KMS verification path.
- The latest CI run passed, but the production worker still has not passed an end-to-end synthetic login run.
