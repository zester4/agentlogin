# Security model and release gates

Assets include credential plaintext, OAuth tokens, cookies, sessions, recovery codes, signing keys, user/tenant data, grants, approvals and audit records. Threat actors include malicious agents/developers, hostile sites and prompt injection, cross-tenant attackers, stolen agent tokens, compromised workers, insiders and supply-chain compromise.

Mandatory controls: distinct user/developer/agent principals; tenant-scoped authorization; exact canonical-origin short-lived grants; per-operation validation of tenant, user, authenticated agent, connected account, scope, current policy version, approval reference/current decision, task/execution-context ID, operation, expiry and revocation; grant IDs are authorization references, not bearer credentials; approval for sensitive writes; envelope encryption with authenticated context binding; decrypt only in isolated workers after fresh authorization; egress controls against loopback/private/link-local/metadata destinations; redirect/frame checks before injection; redaction across DOM/screenshots/logs/traces/errors; rate limits/replay/idempotency controls; secret-free tamper-evident audit; incident response, key rotation, deletion and restore procedures.

Never bypass MFA, CAPTCHA, bot defenses or user-presence checks. Never export profiles, cookies, tokens or passwords to agents. Never claim zero knowledge based on encryption at rest or KMS alone.

Do not accept production credentials until identity, database isolation, vault/KMS, grants, browser isolation, audit controls and adversarial tests are implemented and reviewed. Scaffold and passing unit tests do not establish production security.
