import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@agentlogin/contracts", replacement: new URL("../../packages/contracts/src/index.ts", import.meta.url).pathname },
      { find: "@agentlogin/database", replacement: new URL("../../packages/database/src/index.ts", import.meta.url).pathname },
      { find: "@agentlogin/identity", replacement: new URL("../../packages/identity/src/index.ts", import.meta.url).pathname },
      { find: "@agentlogin/policy", replacement: new URL("../../packages/policy/src/index.ts", import.meta.url).pathname },
      { find: "@agentlogin/vault", replacement: new URL("../../packages/vault/src/index.ts", import.meta.url).pathname }
    ]
  },
  test: { environment: "node" }
});
