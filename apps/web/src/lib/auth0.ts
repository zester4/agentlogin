import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Server-side Auth0 client. API access tokens are requested for the AgentLogin
// resource server and are only consumed by server-side dashboard code/actions.
export const auth0 = new Auth0Client({
  authorizationParameters: {
    ...(process.env.AUTH0_AUDIENCE ? { audience: process.env.AUTH0_AUDIENCE } : {}),
    scope: "openid profile email"
  }
});
