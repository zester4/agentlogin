# Internal credential broker boundary

The API exposes an internal lease-consumption endpoint only when
`AGENTLOGIN_WORKER_TICKET_SIGNING_KEY` is configured. The key is separate from
the agent-token signing key and must be a dedicated random 32-byte secret,
encoded as unpadded base64url (43 characters).

Generate a candidate locally with:

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Do not put this key in an agent, browser, SDK, MCP response, source control, or
client-side environment. Do not configure it in production until the worker
service, workload identity, deployment secret handling, and security review are
ready. With the variable absent or invalid, the internal route is not mounted.

## Ticket contract

The trusted API may mint a ticket after issuing a one-time credential lease.
Tickets are HS256-signed and contain tenant, execution, and lease bindings,
issuer `agentlogin-api`, audience `agentlogin-credential-broker`, issue time,
expiry, and a random token ID. The maximum lifetime is 60 seconds. Verification
pins the algorithm, issuer, and audience and rejects malformed, expired,
future-issued, or overlong tickets.

The current helper is a security primitive; it is not yet connected to the
agent-facing execution coordinator or a deployed worker. Do not hand-mint
tickets for end-user requests or expose the helper to agents.

## Lease consumption

The worker calls:

`POST /internal/v1/credential-leases/consume`

with `Authorization: Bearer <worker-ticket>` and a strict JSON body containing
only `lease_id` and the one-time lease `token`. The API derives tenant and
execution identity from the verified ticket, requires the body lease ID to
match the ticket, and delegates to the tenant-scoped atomic lease repository.
The lease repository rechecks the live grant, account, credential version,
origin, expiry, and revocation state while consuming the lease.

A successful response contains only an opaque vault credential reference and
non-secret execution metadata. It never contains username, password, decrypted
credential bytes, cookies, browser profiles, or session state. Responses use
`Cache-Control: no-store`. The opaque reference still requires a separately
authenticated vault access path inside the trusted worker; this endpoint does
not decrypt credentials.

## Not yet production-ready

This change does not create or deploy a worker, issue tickets from the
coordinator, add a vault-decryption worker adapter, change Railway settings,
enable credential enrollment, or expose a login/MFA SDK or MCP tool. Production
execution remains unavailable until those pieces are implemented, integrated,
tested end-to-end, and explicitly approved.
