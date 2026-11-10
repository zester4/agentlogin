# Isolated login worker: production hardening and acceptance

This runbook describes the production boundary for the isolated Playwright login worker. It is intentionally **not** an instruction to enable credential enrollment or to deploy the worker path before all gates pass.

## Current integration contract

- API service private hostname: `agentlogin-api.railway.internal`
- Login worker private hostname: `agentlogin-worker.railway.internal`
- API `AGENTLOGIN_WORKER_URL`: `http://agentlogin-worker.railway.internal`
- Worker `AGENTLOGIN_API_INTERNAL_URL`: `http://agentlogin-api.railway.internal`
- Worker listens on its configured `PORT` (currently 4180 in Railway).
- API listens on its configured `PORT` (currently 8080 in Railway).

Railway service names and ports are mutable infrastructure facts. Before using these values, re-read the current service private domains and target ports in Railway. Do not substitute public domains. Do not put credentials or signing keys in URLs.

### Safe connectivity checks

1. Confirm the API and worker are in the same Railway project and environment.
2. From the API runtime, resolve the worker's current `.railway.internal` hostname and call only `GET /health`.
3. From the worker runtime, resolve the API's current `.railway.internal` hostname and call only its documented internal broker path using a deliberately invalid synthetic ticket; expect 401. This verifies routing and fail-closed authentication, not lease consumption.
4. Confirm redirects are disabled and no public-domain fallback is configured.
5. Confirm the API and worker have the same worker-ticket signing key by comparing a keyed digest in a trusted operator environment. Never print, copy into a ticket, or send the key to ChatGPT, GitHub, logs, or shell history.

**Do not set `AGENTLOGIN_WORKER_URL` in production yet.** The API's startup code enables the agent login execution route when both this URL and a valid ticket signing key are present. Keep the route disabled until the KMS and database gates below have been independently verified.

## AWS KMS: dedicated worker identity

The worker's `AwsKmsProvider` uses the AWS SDK default credential provider chain and calls KMS `Decrypt` to unwrap a credential DEK. It does not need `Encrypt`, key administration, key listing, rotation configuration, or key deletion permissions.

Use a distinct worker IAM principal from the API principal. Prefer short-lived workload identity federation only after the exact Railway-to-AWS trust claims and token audience have been independently verified. Otherwise use a dedicated IAM access key stored only as Railway secret variables on the login-worker service; never reuse the API key.

The repository's configured vault key is:

- Region: `us-east-1`
- Key ARN: `arn:aws:kms:us-east-1:471742380391:key/ce73891f-9bca-41ea-b9dc-e4555703b4fd`

Proposed worker identity policy (attach only to the worker principal; the KMS key policy must also allow this principal):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DecryptWebsiteLoginEnvelopeKeysOnly",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:us-east-1:471742380391:key/ce73891f-9bca-41ea-b9dc-e4555703b4fd",
      "Condition": {
        "StringEquals": {
          "kms:EncryptionContext:purpose": "website_login"
        }
      }
    }
  ]
}
```

The encryption context is also bound by the application to tenant, account, credential, record version and purpose. The IAM condition is an additional restriction, not a replacement for application-level authorization.

Worker-only Railway variables (all values are set by an authorized AWS/Railway operator, not committed):

| Variable | Value |
|---|---|
| `AWS_REGION` | `us-east-1` |
| `AWS_KMS_KEY_ID` | Exact key ARN above |
| `AWS_ACCESS_KEY_ID` | Dedicated worker identity key ID, if federation is unavailable |
| `AWS_SECRET_ACCESS_KEY` | Dedicated worker identity secret, if federation is unavailable |

Do not add worker credentials to the API, web or MCP service. Do not store AWS credentials in `DATABASE_URL`.

### KMS acceptance

Using only synthetic envelope bytes and synthetic encryption context, verify:

- `kms:Decrypt` succeeds for the AgentLogin key and `purpose=website_login`.
- A different purpose is denied.
- A different KMS key is denied.
- The API identity and worker identity are distinct in CloudTrail.
- Worker identity cannot call `kms:Encrypt`, `kms:GenerateDataKey`, `kms:ScheduleKeyDeletion`, `kms:PutKeyPolicy`, or other administrative actions.
- Disabling/revoking the worker identity causes execution to fail closed.
- Restoring a valid worker identity restores synthetic execution without changing stored ciphertext.
- CloudTrail evidence is retained and reviewed; no plaintext, DEK or credential values are logged.

Do not test by decrypting a real user's credential.

## PostgreSQL: dedicated read-only worker role

The worker's `PostgresCredentialRecordStore.find` reads encrypted credential-envelope fields and connected-account status. It does not need access to grants, approvals, executions, leases, audit events, webhook tables, user records or tenant administration. The API remains responsible for grant validation, lease issuance/consumption and audit writes.

The worker's database role should be a dedicated non-owner login with no superuser, no role creation, no database creation, no replication and no RLS bypass. It should have only:

- CONNECT on the AgentLogin database.
- USAGE on schema `public`.
- SELECT on the exact credential-envelope columns needed by the worker.
- SELECT on `connected_accounts(id, tenant_id, status)`.

Illustrative DBA-only provisioning (replace database name and generated password in the trusted DBA session; never put a password in GitHub or chat):

```sql
CREATE ROLE agentlogin_worker
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

-- Set this from a password manager in the trusted DBA session only.
ALTER ROLE agentlogin_worker PASSWORD '<generated-secret-not-for-git-or-chat>';

GRANT CONNECT ON DATABASE agentlogin TO agentlogin_worker;
GRANT USAGE ON SCHEMA public TO agentlogin_worker;

GRANT SELECT (
  id, tenant_id, account_id, credential_id, credential_type,
  ciphertext, iv, auth_tag, wrapped_dek, key_version,
  record_version, status, revoked_at
) ON TABLE public.credentials TO agentlogin_worker;

GRANT SELECT (id, tenant_id, status)
  ON TABLE public.connected_accounts TO agentlogin_worker;
```

Do not grant table-wide SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER. Do not grant membership in `agentlogin_runtime`, the migration role, or any owner role. The role password should be generated and placed only in the worker service's `DATABASE_URL` secret.

The worker's `PostgresCredentialRecordStore` uses `withTenantTransaction`, which sets transaction-local `app.tenant_id`. Confirm both tables have RLS enabled and tenant-isolation policies that compare `tenant_id` with `current_setting('app.tenant_id', true)`. Because the worker is not table owner and has no `BYPASSRLS`, policies apply. If the worker role is ever made owner, stop and remediate; do not rely on RLS as a protection for table owners unless FORCE ROW LEVEL SECURITY is enabled and verified.

### Database acceptance

Connect using the worker's actual DATABASE_URL in a trusted environment and verify:

```sql
SELECT current_user, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;

SELECT
  has_table_privilege(current_user, 'public.credentials', 'SELECT') AS credential_table_select,
  has_table_privilege(current_user, 'public.credentials', 'INSERT') AS credential_insert,
  has_table_privilege(current_user, 'public.credentials', 'UPDATE') AS credential_update,
  has_table_privilege(current_user, 'public.credentials', 'DELETE') AS credential_delete,
  has_table_privilege(current_user, 'public.grants', 'SELECT') AS grant_select,
  has_table_privilege(current_user, 'public.credential_leases', 'SELECT') AS lease_select;
```

Expected: non-superuser, no RLS bypass; INSERT/UPDATE/DELETE false; grant and lease SELECT false. Column-level SELECT can make table-level `has_table_privilege(..., 'SELECT')` true, so separately inspect `information_schema.column_privileges` and confirm only the listed columns are granted.

Run the existing RLS integration tests with the worker role and two synthetic tenants. Verify a missing tenant context sees zero rows, tenant A cannot see tenant B's credentials/accounts, and the worker cannot write or access grants/leases. Do not run these destructive/seed tests against production data; use a disposable database or rollback-only synthetic transaction.

### Per-service database observability

This branch adds `DATABASE_APPLICATION_NAME` support to the shared database client. Set it on the worker to `agentlogin-login-worker`; leave the API default as `agentlogin-api`. This label improves connection attribution only; it does not change database permissions.

## Synthetic HTTPS login acceptance

Use a disposable synthetic tenant, synthetic grant, synthetic connected account and synthetic credential. The website must be controlled by AgentLogin, reachable over public DNS with valid TLS, and contain no external scripts, fonts, images, analytics or third-party requests. The worker intentionally blocks requests outside the exact approved origin and blocks private/metadata IP destinations. Do not use localhost or an internal Railway URL for a production-mode run.

The synthetic site should expose a deterministic login page:

- `input[autocomplete="username"]` (or supported email/user selector)
- `input[autocomplete="current-password"]`
- A submit button
- A success-only marker, e.g. `[data-testid="login-success"]`
- A deterministic invalid-credentials message
- A deterministic MFA challenge state for the challenge test

The current worker's login detection should be checked against the actual fixture selectors before running. Do not weaken origin restrictions or broaden selectors solely to make the fixture pass.

### Test run order

1. **Connectivity-only:** API-to-worker health request; worker-to-API invalid-ticket request. No execution route activation.
2. **KMS-only:** encrypt/decrypt a random synthetic DEK with the worker principal and verify context mismatch denial.
3. **Database-only:** use synthetic rows in a disposable database; verify column grants, RLS isolation and read-only denial.
4. **Worker-only:** submit an intentionally invalid ticket and malformed body; verify 401/400 and no browser launch.
5. **End-to-end:** only after stages 1–4 pass, configure the private API worker URL in a controlled non-production environment. Issue a synthetic approved grant and one-time lease, execute login, verify only a safe outcome returns, then revoke/expire the lease and clean up the synthetic records.
6. **Negative cases:** wrong tenant, wrong agent, wrong origin, expired ticket, replayed lease, revoked lease, invalid password, MFA challenge, cross-origin redirect, private IP, metadata IP, KMS denial, database denial, browser timeout and worker shutdown.
7. **Evidence:** retain test IDs, timestamps, deployment IDs, safe status codes, KMS CloudTrail event IDs and sanitized audit references. Never retain passwords, cookies, authorization headers, lease tokens, plaintext, DEKs or browser storage state.

### Required result and fail-closed behavior

The API may return only a safe result such as:

```json
{
  "status": "login_succeeded"
}
```

A negative result must be one of the documented safe reason codes. The worker must destroy its browser context after every execution. A KMS, database, broker, ticket, timeout or policy failure must fail closed and must not fall back to API-side browser execution or public worker networking.

MFA currently returns `challenge_detected`; a secure MFA handoff/resume feature is not part of this acceptance and remains a separate release blocker.

## Production activation gate

Do not set the production API's `AGENTLOGIN_WORKER_URL` until all of the following are signed off:

- Current Railway private domains and ports independently verified.
- Worker-ticket signing-key parity verified without exposing the key.
- Dedicated worker KMS identity and deny tests verified.
- Dedicated worker database role and column-level grants verified.
- RLS and cross-tenant tests pass under the actual worker role.
- Synthetic HTTPS login and negative test suite pass.
- Audit evidence and secret-safe telemetry reviewed.
- Rollback procedure tested.
- Credential enrollment remains disabled.

After approval, configure only the API's private worker URL and worker's dedicated KMS/database identity. Do not enable credential enrollment as part of this change. Deploy through the normal reviewed PR/CI process, verify health and synthetic execution, and keep an immediate rollback path to remove the API worker URL and restore the execution route to disabled.
