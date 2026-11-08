import { buildApp } from "./app.js";
import { PostgresIdentityStore } from "./identity/postgres-store.js";
import { StaticJwksUserTokenVerifier } from "./identity/user-jwt.js";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL;
const store = databaseUrl ? new PostgresIdentityStore(databaseUrl) : undefined;

let userTokenVerifier: StaticJwksUserTokenVerifier | undefined;
if (process.env.OIDC_ISSUER && process.env.OIDC_AUDIENCE && process.env.OIDC_JWKS_JSON) {
  userTokenVerifier = new StaticJwksUserTokenVerifier({
    issuer: process.env.OIDC_ISSUER,
    audience: process.env.OIDC_AUDIENCE,
    jwksJson: process.env.OIDC_JWKS_JSON
  });
}

const bootstrapSecret = process.env.AGENTLOGIN_BOOTSTRAP_SECRET;
const app = buildApp({
  ...(store ? { identityStore: store } : {}),
  ...(userTokenVerifier ? { userTokenVerifier } : {}),
  ...(bootstrapSecret ? { bootstrapSecret } : {})
});

try {
  await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? "0.0.0.0" });
} catch (error) {
  app.log.error({ err: { name: error instanceof Error ? error.name : "UnknownError" } }, "server startup failed");
  await store?.close();
  process.exitCode = 1;
}

process.once("SIGTERM", async () => {
  await app.close();
  await store?.close();
});
process.once("SIGINT", async () => {
  await app.close();
  await store?.close();
});
