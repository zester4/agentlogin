import { createWorkerTicket } from "./worker-ticket.js";
import type { IsolatedBrowserProvider, LoginExecutionOutcome, LoginExecutionRequest } from "./index.js";

type FetchLike = typeof fetch;

function workerOrigin(value: string, allowInsecureLocalhost: boolean): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("A valid isolated worker URL is required."); }
  const local = allowInsecureLocalhost && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const railwayPrivate = url.hostname.endsWith(".railway.internal");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.protocol === "https:" || (url.protocol === "http:" && (local || railwayPrivate)))) {
    throw new TypeError("The isolated worker must use HTTPS or an explicitly allowed private/local endpoint.");
  }
  return url.origin;
}

function isOutcome(value: unknown): value is LoginExecutionOutcome {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.status === "login_succeeded") return Object.keys(item).length === 1;
  if (item.status === "mfa_required") return typeof item.handoffRef === "string" && item.handoffRef.length > 0 && Object.keys(item).every((key) => ["status", "handoffRef"].includes(key));
  if (item.status === "user_action_required") return typeof item.actionRef === "string" && item.actionRef.length > 0 && Object.keys(item).every((key) => ["status", "actionRef"].includes(key));
  return item.status === "login_failed" &&
    ["invalid_credentials", "site_unavailable", "unsupported_flow", "challenge_detected"].includes(String(item.reasonCode)) &&
    Object.keys(item).every((key) => ["status", "reasonCode"].includes(key));
}

/**
 * API-side transport to a separately isolated login worker.
 * The worker ticket is short-lived and bound to the tenant, execution and lease.
 * The one-time lease token is sent only to this authenticated worker boundary;
 * it must never be returned to an agent or written to logs.
 */
export class HttpIsolatedBrowserProvider implements IsolatedBrowserProvider {
  private readonly origin: string;
  private readonly fetcher: FetchLike;
  private readonly signingKey: Uint8Array;
  private readonly requestTimeoutMs: number;
  private readonly activeTickets = new Map<string, { ticket: string; expiresAt: number }>();

  constructor(options: {
    workerUrl: string;
    signingKey: Uint8Array;
    fetchImpl?: FetchLike;
    allowInsecureLocalhost?: boolean;
    requestTimeoutMs?: number;
  }) {
    if (options.signingKey.byteLength < 32) throw new TypeError("Worker ticket signing key must contain at least 32 bytes.");
    this.origin = workerOrigin(options.workerUrl, options.allowInsecureLocalhost ?? false);
    this.signingKey = new Uint8Array(options.signingKey);
    this.fetcher = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 100 || this.requestTimeoutMs > 30_000) {
      throw new TypeError("Worker request timeout must be between 100 and 30000 milliseconds.");
    }
  }

  async executeLogin(request: LoginExecutionRequest): Promise<LoginExecutionOutcome> {
    const ticket = createWorkerTicket({
      tenantId: request.tenantId, executionId: request.executionId,
      leaseId: request.credentialLease.leaseId
    }, this.signingKey, { ttlSeconds: 60 });
    this.activeTickets.set(request.executionId, { ticket, expiresAt: Date.now() + 60_000 });

    const { credentialLease, ...execution } = request;
    try {
      const remainingMs = request.deadline.getTime() - Date.now();
      if (remainingMs <= 0) return { status: "login_failed", reasonCode: "site_unavailable" };
      const response = await this.fetcher(this.origin + "/internal/v1/executions/login", {
        method: "POST",
        headers: {
          authorization: "Bearer " + ticket,
          "content-type": "application/json",
          "cache-control": "no-store"
        },
        body: JSON.stringify({
          ...execution,
          credentialLease: {
            leaseId: credentialLease.leaseId,
            token: credentialLease.token,
            expiresAt: credentialLease.expiresAt.toISOString()
          }
        }),
        signal: AbortSignal.timeout(Math.min(this.requestTimeoutMs, remainingMs))
      });
      if (!response.ok) return { status: "login_failed", reasonCode: "site_unavailable" };
      const result: unknown = await response.json();
      return isOutcome(result) ? result : { status: "login_failed", reasonCode: "unsupported_flow" };
    } catch {
      return { status: "login_failed", reasonCode: "site_unavailable" };
    }
  }

  async terminate(executionId: string): Promise<void> {
    const active = this.activeTickets.get(executionId);
    this.activeTickets.delete(executionId);
    if (!active || active.expiresAt <= Date.now()) return;
    try {
      await this.fetcher(this.origin + "/internal/v1/executions/" + encodeURIComponent(executionId) + "/terminate", {
        method: "POST",
        headers: { authorization: "Bearer " + active.ticket, "cache-control": "no-store" },
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });
    } catch {
      // Worker must enforce its own hard execution deadline and clean up sessions
      // even if this best-effort termination signal cannot be delivered.
    }
  }

  async healthCheck(): Promise<{ available: boolean }> {
    try {
      const response = await this.fetcher(this.origin + "/health", {
        method: "GET", signal: AbortSignal.timeout(this.requestTimeoutMs)
      });
      return { available: response.ok };
    } catch {
      return { available: false };
    }
  }
}
