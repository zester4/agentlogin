# SDK release readiness

Status: **source packages prepared; npm publication not yet performed**.

## Packages

Publish in this order:
1. @agentlogin/contracts — shared Zod schemas and TypeScript types.
2. @agentlogin/sdk — server-side TypeScript client; depends on the contracts package.

Both packages currently declare version 0.2.0, ESM exports, declaration output, dist-only package contents, and public npm access. The SDK uses the workspace:^ dependency protocol; pnpm publish must rewrite this to a registry-compatible semver dependency in the packed manifest.

## Release prerequisites

- Confirm the npm account/organization owns or can publish under the @agentlogin scope.
- Add repository Actions secret NPM_TOKEN with publish permission. Never place the token in source, a workflow file, an issue, or chat.
- Run repository CI and inspect actual package tarballs with pnpm pack / npm pack --dry-run.
- Verify each tarball contains runtime JS, declaration files, license, and README; no environment files, tests, or workspace-only references.
- Verify ESM imports work from a clean consumer project on the supported Node.js version.
- Publish contracts before SDK and verify both registry versions before creating the GitHub release.
- Use immutable versions; never overwrite a published version. Bump both packages together when the public contract changes.

## Automated release

.github/workflows/publish-sdk.yml supports manual dispatch and sdk-v* tags. It builds and tests the workspace, publishes contracts first and SDK second using the NPM_TOKEN Actions secret, and requires the secret to exist. A successful workflow is required before announcing the packages.

Suggested first tag after the release gate: sdk-v0.2.0.

## Current SDK capabilities

- getAgentIdentity()
- requestGrant(userId, input)
- getGrantStatus(grantId)
- Static token or per-request token provider
- Configurable timeouts, bounded retries for safe GET requests, typed HTTP errors
- Shared runtime validation with @agentlogin/contracts

Grant mutations are not automatically retried. Do not add retry-on-POST until server-side idempotency keys are implemented. This SDK is for trusted server/agent runtimes, not browser bundles.

## Not included in this release

- Credential/password/token/cookie retrieval (intentionally prohibited).
- Browser login execution or session access.
- Webhook endpoint management or webhook delivery helpers (planned; see WEBHOOKS.md).
- MCP OAuth 2.1 authorization discovery.
- A claim that the full AgentLogin credential vault or browser execution product is production-ready.

## Release checklist

- [ ] CI green on the release commit.
- [ ] MCP service deployment healthy and authenticated remote MCP smoke test passed.
- [ ] SDK and contracts tarballs inspected.
- [ ] Clean consumer install and ESM import smoke test passed.
- [ ] npm scope ownership and NPM_TOKEN secret verified by the workflow owner.
- [ ] Publish contracts package.
- [ ] Publish SDK package.
- [ ] Verify npm registry metadata and install exact versions in a clean project.
- [ ] Create GitHub release with changelog, compatibility notes, and docs links.
