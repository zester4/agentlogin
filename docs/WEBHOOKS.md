# Webhooks and live synchronization

Status: **transactional outbox and disabled worker implemented; first tenant-authenticated endpoint management routes are implemented behind a fail-closed feature gate. Delivery history/replay, SDK helpers, dashboard live sync, and end-to-end verification remain incomplete**. Do not advertise webhooks as available or enable production delivery until the remaining gates pass.

## Decision

AgentLogin needs webhooks for server-to-server integrations. They are not required for every integration: developers can use the REST API/SDK and poll grant status. Webhooks are the efficient path when developers need prompt notification without repeated polling.

Webhooks are not the source of truth. The API and database remain authoritative. A webhook tells a consumer that something changed; the consumer fetches the current resource using its own authenticated API credential.

## Implementation status (8 November 2026)

Merged and deployed foundations:
- Tenant-scoped endpoint, event, delivery, attempt, and durable queue schema/migrations.
- Transactional `enqueueWebhookEvent(tx, input)` repository primitive.
- Queue RLS and FORCE RLS; runtime role has no direct queue UPDATE/DELETE privileges.
- Dedicated `NOLOGIN` queue executor owns narrowly scoped SECURITY DEFINER claim/complete functions. It has `BYPASSRLS` only for those queue functions and no schema CREATE privilege.
- Worker claims leased jobs, records attempts, retries/backoffs, and handles completion/dead-letter paths.
- HMAC signing, KMS context `webhook_signing_secret`, and HTTPS/SSRF-safe outbound request protections are implemented.
- Railway API, web, MCP, and webhook worker services are online. The worker is deliberately disabled and does not poll the queue.

Still incomplete:
- Confirm every intended domain state transition writes its event in the same transaction.
- Implement tenant-authenticated endpoint CRUD, test delivery, history, and replay APIs/SDK helpers. Initial create/list/update/disable routes are implemented behind `WEBHOOK_ENDPOINTS_ENABLED=true`; the gate is absent/disabled by default and no production variable was changed.
- Implement dashboard SSE invalidation, cursor recovery, reconnect/backoff, and bounded polling fallback.
- Complete production-like end-to-end delivery and adversarial tests before enabling the worker.

## Event flow

1. A domain transaction changes a grant, approval, connected account, or execution.
2. The same database transaction inserts an immutable event into a tenant-scoped outbox.
3. A worker claims due outbox rows using a lease and SKIP LOCKED, then delivers to active endpoint subscriptions.
4. Each delivery includes a stable event ID, event type, creation time, tenant-scoped resource reference, and minimal payload. Never include credentials, tokens, cookies, password fields, recovery codes, browser state, or secret-bearing provider responses.
5. The receiver verifies the signature and timestamp, stores the event ID for deduplication, acknowledges quickly with 2xx, and processes asynchronously.
6. The worker records attempts, schedules bounded exponential backoff with jitter for retryable failures, and eventually moves exhausted deliveries to a dead-letter state. Developers can inspect and replay a delivery.

## Initial event catalogue

- account.connected
- account.connection_updated
- account.disconnected
- grant.requested
- grant.approval_required
- grant.approved
- grant.denied
- grant.revoked
- grant.expired
- execution.started
- execution.completed
- execution.failed

Only emit an event after the corresponding state change commits. Use versioned event schemas and additive changes within a major event version.

## Delivery security

- HTTPS only; reject localhost, loopback, link-local, private, multicast, reserved, and cloud-metadata destinations. Resolve and validate DNS at delivery time and revalidate every redirect (prefer no redirects).
- Bind subscriptions to a tenant and authenticated developer owner. Never accept an arbitrary destination from an agent request.
- Generate a distinct high-entropy signing secret per endpoint; show it once, store only a verifier/encrypted form as designed, and support rotation with a short overlap window.
- Sign the exact raw request body with HMAC-SHA256. Include X-AgentLogin-Event-Id, X-AgentLogin-Delivery-Id, X-AgentLogin-Timestamp, and X-AgentLogin-Signature: v1=<hex>.
- Receivers must reject stale timestamps (recommended five-minute window), verify signatures with constant-time comparison, and deduplicate by event ID.
- Do not put secrets in URLs, event bodies, logs, traces, or error messages.
- Rate-limit endpoint creation, delivery, replay, and manual test operations. Enforce per-tenant quotas and payload size limits.

## Reliability contract

- At-least-once delivery; duplicates are possible and expected.
- Stable event ID across retries; unique delivery ID per endpoint/event pair.
- Durable outbox; no fire-and-forget in-process-only dispatch.
- Lease-based workers, bounded concurrency, per-endpoint ordering where practical, exponential backoff with jitter, retry-after support, dead-letter visibility, manual replay, and delivery retention.
- Consumer acknowledgement means accepted, not completed. Consumers should enqueue work and return 2xx quickly.
- Provide delivery attempt timestamps, HTTP status, latency, next retry, and redacted response summary.

## Frontend synchronization

The browser must never receive webhook signing secrets or accept inbound webhooks directly. The dashboard should use authenticated server-side API reads and a live-update channel (SSE is the preferred first implementation) that emits only safe resource invalidation/status events. If SSE disconnects, reconnect with backoff and fall back to bounded polling. The browser then refetches the authoritative resource. Use a cursor/last-event ID to recover missed updates; never treat an in-memory event stream as durable state.

## API surface to implement

Developer-authenticated endpoints, tenant-scoped:
- POST /v1/developers/:developerId/webhook-endpoints — create endpoint and return signing secret once (requires `WEBHOOK_ENDPOINTS_ENABLED=true`).
- GET /v1/developers/:developerId/webhook-endpoints — list endpoint metadata, never secret.
- PATCH /v1/developers/:developerId/webhook-endpoints/:endpointId — update URL/event subscriptions/active state (requires the feature gate).
- DELETE /v1/developers/:developerId/webhook-endpoints/:endpointId — disable endpoint (requires the feature gate).
- GET /v1/webhook-deliveries — list delivery status and attempts.
- POST /v1/webhook-deliveries/:id/replay — enqueue a safe replay.
- POST /v1/webhook-endpoints/:id/test — send a signed test event.

The dashboard should expose endpoint setup, one-time secret reveal, event selection, delivery history, retry/replay, and rotate-secret controls.

## Implementation sequence

1. Database schema/migrations and queue isolation — implemented and deployed.
2. Transactional event emitter — repository primitive exists; verify integration into every intended domain transition.
3. Delivery worker — implemented and deployed disabled; finish adversarial and end-to-end verification.
4. Developer API and SDK types/helpers; initial tenant-authenticated endpoint create/list/update/disable routes are implemented behind a default-off feature gate; never expose endpoint secrets after creation.
5. Dashboard endpoint management and safe SSE invalidation stream with cursor/reconnect/polling fallback.
6. Integration tests for commit atomicity, tenant isolation, signature validation, stale timestamps, DNS rebinding/private IPs, duplicates, retries, ordering, replay, secret redaction, and SSE reconnect/fallback.

## Important boundaries

Webhooks do not authorize actions and must never carry credentials. A delivery failure must not roll back an already-committed grant or account change. Webhook delivery is asynchronous and cannot be the only way the UI learns current state. Until this system is implemented and tested, describe webhooks as planned, not supported.
