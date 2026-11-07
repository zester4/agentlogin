import type { Database } from "./client.js";

export type TenantTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
