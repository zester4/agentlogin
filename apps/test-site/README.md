# AgentLogin synthetic login site

This is a **local-only test fixture**, not a customer-facing product and not a production service. It exists so AgentLogin's future API/SDK/MCP execution flow can be exercised against a predictable website without using anyone's real account.

## Start locally

```bash
pnpm --filter @agentlogin/test-site start
```

Open http://127.0.0.1:4173/login.

The server refuses production mode and binds only to loopback. It uses in-memory sessions and has no database, external network calls, telemetry, or real user data.

## Synthetic account

- Email: `agentlogin-test@example.com`
- Password: `agentlogin-synthetic-password`
- MFA code: `246810`

These values are disposable test fixtures. Never reuse them for any real service.

## Scenarios

- `GET /login` — standard login form.
- `GET /login?scenario=mfa` — login form that pauses for synthetic MFA.
- `POST /login` — valid credentials create an HttpOnly, SameSite=Strict session cookie; invalid credentials return 401.
- `POST /mfa` — completes the MFA scenario.
- `GET /session` — reports only whether the synthetic session is authenticated.
- `POST /logout` — destroys the synthetic session.
- `GET /health` — local health check.

Run its integration tests:

```bash
pnpm --filter @agentlogin/test-site test
```

## Important boundary

This fixture tests website behavior only. It does **not** claim that AgentLogin's API, SDK, or MCP can log into it yet. The execution endpoint and a trusted execution provider must be wired and tested before that end-to-end claim is made.
