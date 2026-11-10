# SDK release readiness

Status: **source packages prepared; npm publication not yet performed**.

## Packages

Publish in this order:
1. @agentlogin/contracts — shared Zod schemas and TypeScript types.
2. @agentlogin/sdk — server-side TypeScript client; depends on the contracts package.

Both packages currently declare version 0.2.0, ESM exports, declaration output, explicit dist/README/LICENSE package contents, and public npm access. The SDK uses the workspace:^ dependency protocol; pnpm publish must rewrite this to a registry-compatible semver dependency in the packed manifest.

## Release prerequisites

- Confirm the npm account/organization owns or can publish under the @agentlogin scope.
- For the one-time first publication only, publish both packages interactively with npm 2FA from a trusted developer machine. npm requires a package to exist before its trusted publisher can be configured.
- After the first publication, configure a GitHub Actions trusted publisher separately on each npm package: owner `zester4`, repository `agentlogin`, workflow filename `publish-sdk.yml`, no environment, and allow `npm publish`.
- The automated workflow uses npm trusted publishing (OIDC), not a long-lived NPM_TOKEN. Keep 2FA enabled on the npm account.
- Run repository CI and inspect actual package tarballs with pnpm pack / npm pack --dry-run.
- Verify each tarball contains runtime JS, declaration files, license, and README; no environment files, tests, or workspace-only references.
- Verify ESM imports work from a clean consumer project on the supported Node.js version.
- Publish contracts before SDK and verify both registry versions before creating the GitHub release.
- Use immutable versions; never overwrite a published version. Bump both packages together when the public contract changes.

## Automated release

.github/workflows/publish-sdk.yml supports manual dispatch and sdk-v* tags. It validates the version against both manifests, installs the workspace without relying on a lockfile that is not committed, runs the full build/lint/typecheck/test suite, inspects both tarballs, verifies a Node/npm runtime compatible with npm trusted publishing, publishes the packed contracts tarball before the SDK using GitHub Actions OIDC, verifies a clean consumer install, and creates the matching GitHub Release. Existing immutable npm versions are not overwritten. The first package versions must be published interactively once before trusted publishers can be configured.

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
- [ ] Both npm packages have a GitHub Actions trusted publisher configured (owner `zester4`, repo `agentlogin`, workflow `publish-sdk.yml`).
- [ ] Publish contracts package.
- [ ] Publish SDK package.
- [ ] Verify npm registry metadata and install exact versions in a clean project.
- [ ] Confirm the workflow-created GitHub Release has the expected tag, package links, and release notes.
