import { buildApp } from "./app.js";
const app = buildApp();
try {
  await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? "0.0.0.0" });
} catch (error) {
  app.log.error({ err: error }, "server startup failed");
  process.exitCode = 1;
}
