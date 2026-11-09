import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { normalizePostgresSslMode } from "./packages/database/src/postgres-ssl.js";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/database/src/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: normalizePostgresSslMode(
      process.env.DATABASE_URL_UNPOOLED ??
        process.env.DATABASE_URL ??
        "postgresql://localhost:5432/agentlogin",
    ),
  },
  strict: true,
  verbose: true,
});
