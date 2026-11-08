import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Server-side Auth0 client. Configuration is read from environment variables;
// never expose AUTH0_CLIENT_SECRET or AUTH0_SECRET to browser code.
export const auth0 = new Auth0Client();
