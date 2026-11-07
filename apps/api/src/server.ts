import { createDatabase } from "@agentlogin/database";
import { buildApp } from "./app.js";

const database = createDatabase();
const app = buildApp(database.pool);

try {
  await app.listen({
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? "0.0.0.0",
  });
} catch (error) {
  app.log.error({ err: error }, "server startup failed");
  await app.close();
  process.exitCode = 1;
}
