# AgentLogin KMS operational security runbook

**Status:** Procedure draft; live AWS evidence and operator sign-off are still required.  
**Scope:** AWS KMS key `alias/agentlogin-vault`, the API workload IAM identity, and the encrypted credential-vault lifecycle.  
**Safety invariant:** Keep `CREDENTIAL_ENROLLMENT_ENABLED` unset or set to `false` in production until issue #51's release gates are independently verified and approved. Do not use real customer credentials during these checks.

## 1. Preconditions and evidence handling

- Perform this review with an authorized AWS operator using the approved AWS account and an MFA-protected administrative session.
- Confirm the AWS account ID, region (`us-east-1`), KMS key ARN, alias target, API workload IAM principal, and Railway production service before inspecting events.
- Never paste access keys, secret keys, session tokens, plaintext credentials, decrypted data keys, or raw secret-bearing application logs into GitHub, chat, tickets, or this repository.
- Store evidence in the approved restricted security-evidence location. Record timestamps in UTC, account/region, query scope, reviewer, and pass/fail; redact account-specific identifiers where the evidence leaves the security team.
- Do not enable credential enrollment, change the key policy, disable/delete the key, or rotate live credentials as part of a read-only review.

## 2. Verify the KMS key and IAM principal

Using an authorized AWS CLI profile (never a long-lived key pasted into a command):

```sh
aws sts get-caller-identity
aws kms describe-key --key-id alias/agentlogin-vault --region us-east-1
aws kms get-key-rotation-status --key-id alias/agentlogin-vault --region us-east-1
aws kms list-aliases --region us-east-1
```

Record and verify:

- The account and region are the intended production account and `us-east-1`.
- The alias resolves to the dedicated symmetric encryption key expected by AgentLogin.
- The key is enabled and its key state is `Enabled`.
- Key usage is `ENCRYPT_DECRYPT` and key spec is symmetric.
- Automatic key-material rotation is enabled where supported by the key type and organizational policy.
- The API principal is the dedicated least-privilege workload identity, not a human administrator.
- The API identity has only the required data-plane permissions for this key (Encrypt/Decrypt, plus only other permissions explicitly justified by the implementation); it must not have key-administration permissions.
- Key administrators and key users are separate roles. Confirm a documented, tested break-glass administrator can recover access without granting the API role administrative privileges.

Do not copy key material; AWS KMS customer-managed key material is not exportable.

## 3. CloudTrail review — expected principal and KMS operations

Use CloudTrail Event history or the organization's centralized trail/SIEM. Event history is limited to its retention window; use the centralized trail for longer periods. Select a review window that includes the synthetic vault lifecycle test and the most recent production API activity.

Read-only CLI query:

```sh
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventSource,AttributeValue=kms.amazonaws.com \
  --start-time '<UTC-START>' --end-time '<UTC-END>' \
  --region us-east-1
```

Inspect the returned `CloudTrailEvent` JSON locally in the approved security environment. For each relevant `Encrypt` and `Decrypt` event, verify:

- `eventSource` is `kms.amazonaws.com`; `eventName` is expected.
- `awsRegion` and `resources[].ARN` identify the intended production key.
- `userIdentity` identifies the expected API workload IAM principal or its assumed role session. Investigate human, unknown, or unexpected principals.
- `requestParameters.encryptionContext` contains the expected tenant/account/credential/version/purpose binding, without exposing credential values.
- Events correlate with expected synthetic lifecycle activity and service deployment/test windows.
- No unexpected `DisableKey`, `ScheduleKeyDeletion`, `PutKeyPolicy`, `CreateGrant`, `RevokeGrant`, `RetireGrant`, or other key-administration activity occurred.

Important: CloudTrail records KMS API metadata and encryption context, not the plaintext credential or plaintext data-encryption key. The encryption context contains identifiers and purpose metadata; treat it as sensitive operational metadata and do not publish it broadly.

Capture event IDs, timestamps, principal classification, key ARN (redacted in broadly shared evidence), operation, and outcome. Do not attach raw event dumps to the pull request.

## 4. Application logs and telemetry — secret-leak review

CloudTrail alone cannot prove that application logs, traces, errors, request capture, or worker telemetry are secret-free. Review the API service logs and any configured log/trace/telemetry sinks over the same test window.

Check the logging configuration and representative request/error paths for accidental capture of:

- Request bodies or parsed username/password fields.
- Authorization headers, cookies, bearer tokens, OAuth refresh tokens, API keys, and session material.
- Plaintext credential JSON, decrypted credential buffers, or plaintext DEKs.
- KMS request payloads, SDK debug output, environment variables, or full database rows.
- Secret-bearing screenshots, DOM/accessibility snapshots, browser traces, crash dumps, or worker IPC.

Use synthetic canary markers only in an isolated test environment. Search restricted logs for the exact canary marker and report only match counts, log source, and timestamps—not matching message contents. A zero-result search is evidence for the searched sinks and time range only; it does not prove that every sink is covered.

Verify that API error responses remain generic and that request-body logging/redaction is configured at the framework, proxy, APM, and infrastructure layers. If any secret is found, preserve restricted evidence, stop the affected workflow, treat it as a security incident, and rotate/revoke the exposed credential through the approved incident process.

## 5. IAM access-key rotation — controlled procedure

The API's IAM access key is distinct from the KMS key. Rotate only under an approved change window with an authorized operator and a rollback plan.

1. Confirm the API workload identity and all consumers of its access key. Prefer migration to short-lived workload identity/role credentials over permanent IAM user keys where Railway's deployment model supports it.
2. Confirm the existing key ID, last-used data, service ownership, and the currently deployed Railway API version. Do not retrieve or display the old secret access key.
3. Create a replacement access key for the dedicated service identity using the approved AWS IAM process. The secret is displayed only at creation; place it directly into the approved secret manager/Railway API service variable flow. Never place it in source control, build arguments, frontend variables, logs, or chat.
4. Deploy/restart only the API service with the replacement pair. Do not put AWS credentials on web, MCP, or worker services unless separately justified and approved.
5. Verify API health and a synthetic KMS Encrypt/Decrypt round trip with the expected encryption context. Confirm CloudTrail shows the new key's principal/session making the expected operations.
6. After successful verification, deactivate the old access key. Observe the agreed rollback window and check for failed KMS calls or unexpected consumers.
7. Delete the old access key only after the observation period and owner sign-off. Confirm the old key is no longer active and update the rotation record.
8. If verification fails, restore the previous known-good configuration only while the old key remains active and within the approved rollback window; investigate before retrying.

Never create multiple overlapping keys without tracking ownership and a deletion deadline. Never deactivate the only working key before the replacement has been verified.

## 6. KMS key rotation, recovery, and encrypted-data backup

- Enable and verify AWS KMS automatic rotation for the symmetric customer-managed key where supported and required by policy. Record the rotation status and next review date.
- KMS automatic rotation preserves the logical key and allows KMS to use historical backing key material to decrypt existing ciphertext. It does not replace application envelope-format/version migrations.
- Preserve the KMS key, key policy, alias, IAM policy, and access-control configuration through infrastructure-as-code or approved configuration backups. These records do not contain key material.
- Back up the encrypted database records, including ciphertext, IV, authentication tag, wrapped DEK, key ARN/version, AAD version, and the exact context fields needed to decrypt. Backups must remain encrypted and access-controlled.
- A database backup without continued access to the corresponding KMS key is not a recoverable credential backup. KMS key material cannot be exported or reconstructed from the database backup.
- Test restore in an isolated environment using a recoverable KMS key and synthetic records. Verify correct-context decrypt succeeds and altered tenant/account/credential/version/purpose context fails.
- Restrict key disablement, policy changes, alias changes, and deletion scheduling to designated key administrators with approval and alerting.
- Do not schedule deletion of the production key. KMS key deletion is irreversible after the waiting period and would make dependent wrapped DEKs undecryptable.
- Define an emergency access path for lost IAM access, key-policy lockout, compromised credentials, accidental key disablement, and regional/service outage. Test it without exposing key material or production credentials.

## 7. Incident response checklist

For suspected IAM-key compromise, unexpected KMS use, secret leakage, or key-policy tampering:

1. Declare an incident and notify the security owner; record UTC time and affected systems.
2. Keep credential enrollment disabled. Stop affected credential-processing/execution paths if containment requires it.
3. Preserve CloudTrail, Railway deployment/audit records, and restricted log evidence; do not copy secret values into the incident ticket.
4. Revoke or deactivate compromised IAM access keys and issue replacement credentials through the approved secret-management process.
5. Inspect KMS key policy, grants, aliases, key state, and CloudTrail for unauthorized changes or use.
6. Do not disable or schedule deletion of the KMS key as a reflexive response; doing so can permanently interrupt recovery of all credentials encrypted under it. Follow the key-compromise runbook and AWS guidance with the designated key administrator.
7. Assess whether any credential plaintext or decrypted DEK could have escaped the approved boundary. Revoke/rotate affected connected-account credentials using the secure recovery process.
8. Restore service only after containment, key access verification, synthetic decrypt/negative-context tests, and security-owner approval.
9. Document root cause, scope, affected tenants, actions, recovery validation, and follow-up controls.

## 8. Sign-off record

Complete this table in the approved security review, not by guessing from code or deployment health.

| Control | Evidence required | Status |
| --- | --- | --- |
| Correct KMS key, account, region, key state | `DescribeKey`, alias, rotation status | Pending live review |
| Expected IAM principal and KMS operations | CloudTrail event review | Pending live review |
| No plaintext credential/DEK in logs | API/proxy/APM/worker sink review | Pending live review |
| IAM access-key rotation | Approved change record and successful synthetic KMS test | Pending controlled exercise |
| KMS recovery and backup/restore | Isolated restore and context-binding test | Pending controlled exercise |
| Incident response | Named owners, escalation path, tabletop evidence | Pending review |
| Independent security approval | Signed review with no unresolved critical/high findings | Pending |

**Release decision:** Enrollment remains locked until every issue #51 security gate is verified, evidence is recorded, and an independent security reviewer approves the release.
