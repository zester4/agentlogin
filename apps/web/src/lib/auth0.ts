import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Server-side Auth0 client. API access tokens are requested for the AgentLogin
// resource server and remain inside the Next.js server session/BFF boundary.
export const auth0 = new Auth0Client({
  authorizationParameters: {
    ...(process.env.AUTH0_AUDIENCE ? { audience: process.env.AUTH0_AUDIENCE } : {}),
    ...(process.env.AUTH0_ORGANIZATION ? { organization: process.env.AUTH0_ORGANIZATION } : {}),
    scope: "openid profile email"
  }
});
