// Keep the privileged migration connection out of the long-running API process.
delete process.env.DATABASE_URL_UNPOOLED;
await import("../apps/api/dist/server.js");
