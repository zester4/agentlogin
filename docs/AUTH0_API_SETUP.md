# Auth0 API audience and trusted workspace setup

This guide configures Auth0 as the user identity provider for the AgentLogin control plane and Fastify API.

The API verifies a signed access token against an exact issuer, API audience, HTTPS JWKS endpoint, allowed asymmetric algorithms, and a namespaced tenant claim. Do not copy the Auth0 Management API audience, the web application's Client ID, or a user-editable profile field into these settings.

## 1. Create the AgentLogin API

In the Auth0 Dashboard:

1. Open **Applications → APIs**.
2. Select **Create API**.
3. Use:
   - **Name:** AgentLogin API
   - **Identifier:** `https://api.agentlogin.app`
   - **Signing Algorithm:** RS256
4. Create the API and copy the **Identifier** exactly. This is the audience.
5. Do not enable broad permissions or machine-to-machine grants for this dashboard flow. The current user API authenticates by issuer, audience, signature, and trusted tenant claim; it does not yet enforce API RBAC permissions.

The identifier is a stable resource-server identifier. It does not need to resolve to a live website.

## 2. Create an Auth0 Organization for the first workspace

1. Open **User Management → Organizations**.
2. Create an organization named **AgentLogin Workspace** (or your preferred workspace name).
3. Add the account that owns the AgentLogin workspace as an organization member.
4. Copy the Organization ID. It begins with `org_`.

AgentLogin uses the Auth0 Organization ID as the initial tenant/workspace identifier. The database stores tenant IDs as text, so this stable Auth0 ID can be used directly. Future workspace switching should select the corresponding Organization at login; never accept a tenant ID from a browser form or ordinary request header.

## 3. Add a Post-Login Action for the trusted tenant claim

1. Open **Actions → Library**.
2. Create a **Login / Post Login** Action named **AgentLogin workspace claim**.
3. Use this code:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  const organizationId = event.organization && event.organization.id;

  // AgentLogin requires an explicit organization context for every API token.
  if (!organizationId) {
    api.access.deny("Select an AgentLogin workspace to continue.");
    return;
  }

  api.accessToken.setCustomClaim(
    "https://agentlogin.app/tenant_id",
    organizationId
  );
};
```

4. Save the Action.
5. Open **Actions → Flows → Login**.
6. Drag **AgentLogin workspace claim** into the Login flow and click **Apply**.

This claim comes from Auth0's authenticated Organization context, not from user_metadata or a browser-supplied value. Do not replace it with a value submitted by the browser.

## 4. Configure the Regular Web Application

Open **Applications → Applications → AgentLogin web application** (the existing Regular Web Application).

In **Settings → Application URIs**, configure:

**Allowed Callback URLs**
```text
https://agentlogin-web-production.up.railway.app/auth/callback
http://localhost:3000/auth/callback
```

**Allowed Logout URLs**
```text
https://agentlogin-web-production.up.railway.app
http://localhost:3000
```

**Allowed Web Origins**
```text
https://agentlogin-web-production.up.railway.app
http://localhost:3000
```

Save changes. Confirm the application type is **Regular Web Application**, not Single Page Application. Keep its Client Secret private.

## 5. Configure Railway variables

### AgentLogin web service

Set these variables on the **web** service only:

| Variable | Value |
|---|---|
| `AUTH0_AUDIENCE` | `https://api.agentlogin.app` |
| `AUTH0_ORGANIZATION` | The copied `org_...` Organization ID |
| `AGENTLOGIN_API_URL` | `https://agentlogin-production-90b2.up.railway.app` |

The existing `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, and `APP_BASE_URL` must also be set on the web service. `AUTH0_DOMAIN` is the tenant hostname only (no `https://`); `APP_BASE_URL` is the full web URL.

### AgentLogin API service

Set these variables on the **API** service only:

| Variable | Value |
|---|---|
| `OIDC_ISSUER_URL` | `https://YOUR_AUTH0_DOMAIN/` |
| `OIDC_AUDIENCE` | `https://api.agentlogin.app` |
| `OIDC_JWKS_URL` | `https://YOUR_AUTH0_DOMAIN/.well-known/jwks.json` |
| `OIDC_TENANT_CLAIM` | `https://agentlogin.app/tenant_id` |

Replace `YOUR_AUTH0_DOMAIN` with the exact Auth0 tenant domain, for example `agentlogin.us.auth0.com`. Keep the trailing slash on the issuer URL. If using an Auth0 custom domain, use that same domain consistently for issuer and JWKS.

Do not put Auth0 Client Secret or AUTH0_SECRET on the API service. Do not expose any Auth0 secret or access token in a `NEXT_PUBLIC_*` variable.

## 6. Verify the integration safely

1. Redeploy the web and API services after setting variables.
2. Sign out of AgentLogin, then sign in again so Auth0 issues a fresh access token with the API audience and Organization context.
3. Open the dashboard's **Connected Accounts** or **Approvals** page. The dashboard uses server-side Auth0 token retrieval and calls the API from the Next.js server; the bearer token is not returned to browser JavaScript.
4. The Connected Accounts and Approvals dashboard pages first call `POST /v1/onboarding` server-side with an empty JSON body. The API derives the tenant and user from the verified token; the onboarding repository is idempotent and reuses an existing active membership. The access token remains on the Next.js server.
5. A successful response from `GET /v1/user/me` should contain `authenticated: true`, a tenant ID equal to the configured Auth0 Organization ID, and the authenticated user ID. Do not paste access tokens into jwt.io or share them in chat.
6. If calling the API directly and the user has not been onboarded, call `POST /v1/onboarding` with the same verified user access token and an empty JSON body. If the API returns `user_auth_unavailable`, verify the four `OIDC_*` API variables. If it returns `unauthorized`, check the issuer, audience, signature algorithm, Organization selection, and Post-Login Action deployment.

## Security notes

- Auth0's access token is a user-to-AgentLogin API token. It is not an agent credential and is never passed to an agent.
- The Next.js server obtains the token and makes API calls. Do not fetch the access token from a browser component.
- The API validates RS256/ES256 signatures, exact issuer and audience, token age, and the required namespaced tenant claim.
- A login without an Organization is denied by the Action. This prevents a missing tenant context from silently becoming a default or user-selected tenant.
- Do not enter real website credentials until the production KMS and isolated execution release gates have been verified.
