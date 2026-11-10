import {
  AgentGrantStatusSchema,
  AgentIdentitySchema,
  GrantRequestSchema,
  PendingGrantSchema,
  type AgentGrantStatus,
  type AgentIdentity,
  type GrantRequest,
  type PendingGrant
} from "@agent-login/contracts";

export type AgentTokenProvider = () => string | Promise<string>;

export type AgentLoginClientOptions = {
  baseUrl: string;
  /** Supply either agentToken or tokenProvider, never both. */
  agentToken?: string;
  tokenProvider?: AgentTokenProvider;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
};

export type RequestOptions = { signal?: AbortSignal; timeoutMs?: number };

type ErrorPayload = { error?: { code?: unknown; message?: unknown; details?: unknown } };

export class AgentLoginApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "AgentLoginApiError";
  }
}
export class AgentLoginAuthenticationError extends AgentLoginApiError {
  constructor(message: string, requestId?: string) {
    super(message, 401, "unauthorized", requestId);
    this.name = "AgentLoginAuthenticationError";
  }
}
export class AgentLoginPermissionError extends AgentLoginApiError {
  constructor(message: string, requestId?: string) {
    super(message, 403, "forbidden", requestId);
    this.name = "AgentLoginPermissionError";
  }
}
export class AgentLoginRateLimitError extends AgentLoginApiError {
  constructor(message: string, requestId?: string, readonly retryAfterMs?: number) {
    super(message, 429, "rate_limited", requestId);
    this.name = "AgentLoginRateLimitError";
  }
}
export class AgentLoginValidationError extends AgentLoginApiError {
  constructor(message: string, status: number, code: string, requestId?: string, details?: unknown) {
    super(message, status, code, requestId, details);
    this.name = "AgentLoginValidationError";
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 30_000)) : undefined;
}

function safeError(response: Response, payload: ErrorPayload): AgentLoginApiError {
  const code = typeof payload.error?.code === "string" ? payload.error.code : "request_failed";
  const message = typeof payload.error?.message === "string" ? payload.error.message : "The AgentLogin request could not be completed.";
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const details = payload.error?.details;
  if (response.status === 401) return new AgentLoginAuthenticationError(message, requestId);
  if (response.status === 403) return new AgentLoginPermissionError(message, requestId);
  if (response.status === 429) return new AgentLoginRateLimitError(message, requestId, retryAfterMs(response.headers.get("retry-after")));
  if (response.status === 400 || response.status === 404 || response.status === 409 || response.status === 422) {
    return new AgentLoginValidationError(message, response.status, code, requestId, details);
  }
  return new AgentLoginApiError(message, response.status, code, requestId, details);
}

export class AgentLoginClient {
  private readonly baseUrl: URL;
  private readonly tokenProvider: AgentTokenProvider;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: AgentLoginClientOptions) {
    const base = new URL(options.baseUrl);
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new TypeError("baseUrl must be an HTTP(S) URL without credentials, query, or fragment.");
    }
    if (options.agentToken && options.tokenProvider) {
      throw new TypeError("Provide agentToken or tokenProvider, not both.");
    }
    const tokenProvider = options.tokenProvider ?? (options.agentToken ? () => options.agentToken! : undefined);
    if (!tokenProvider) throw new TypeError("An agentToken or tokenProvider is required.");
    if (options.agentToken !== undefined && !options.agentToken.trim()) throw new TypeError("agentToken cannot be empty.");
    this.baseUrl = new URL(base.toString().endsWith("/") ? base.toString() : base.toString() + "/");
    this.tokenProvider = tokenProvider;
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) {
      throw new RangeError("timeoutMs must be an integer between 1 and 120000.");
    }
    if (!Number.isSafeInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 5) {
      throw new RangeError("maxRetries must be an integer between 0 and 5.");
    }
  }

  async getAgentIdentity(options: RequestOptions = {}): Promise<AgentIdentity> {
    const result = await this.request("GET", "v1/agent/me", undefined, options, true);
    return AgentIdentitySchema.parse(result);
  }

  async getGrantStatus(grantId: string, options: RequestOptions = {}): Promise<AgentGrantStatus> {
    if (!grantId || grantId.trim() !== grantId || grantId.length > 300) throw new TypeError("grantId must be a non-empty grant identifier.");
    const result = await this.request("GET", `v1/agent/grants/${encodeURIComponent(grantId)}`, undefined, options, true);
    return AgentGrantStatusSchema.parse(result);
  }

  async requestGrant(userId: string, request: GrantRequest, options: RequestOptions = {}): Promise<PendingGrant> {
    if (!userId || userId.trim() !== userId || userId.length > 200) throw new TypeError("userId must be a non-empty user identifier.");
    const input = GrantRequestSchema.parse(request);
    const result = await this.request(
      "POST",
      `v1/users/${encodeURIComponent(userId)}/grants`,
      input,
      options,
      false
    );
    return PendingGrantSchema.parse(result);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    options: RequestOptions,
    retryable: boolean
  ): Promise<unknown> {
    const token = await this.tokenProvider();
    if (typeof token !== "string" || !token.trim()) throw new TypeError("The agent token provider returned an empty token.");
    const url = new URL(path, this.baseUrl);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const attempts = retryable ? this.maxRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
        const response = await this.fetcher(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const parsed = payload && typeof payload === "object" ? payload as ErrorPayload : {};
          const error = safeError(response, parsed);
          if (retryable && (response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) && attempt + 1 < attempts) {
            const delay = error instanceof AgentLoginRateLimitError && error.retryAfterMs !== undefined
              ? error.retryAfterMs
              : Math.min(500 * 2 ** attempt + Math.random() * 500, 5_000);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw error;
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (error instanceof AgentLoginApiError || options.signal?.aborted || attempt + 1 >= attempts) throw error;
        const delay = Math.min(500 * 2 ** attempt + Math.random() * 500, 5_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("AgentLogin request failed.");
  }
}


import { Buffer } from "node:buffer";

export type AgentLoginApplicationClientOptions = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type RegisteredAgent = {
  agent_id: string;
  credential: { token: string; expires_at: string; display_once: true };
};

/**
 * Server-side OAuth client-credentials integration. Keep clientSecret on a
 * trusted backend. This client only creates agent identities; use the returned
 * one-time agent credential with AgentLoginClient and store it in a secret manager.
 */
export class AgentLoginApplicationClient {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private readonly options: AgentLoginApplicationClientOptions) {
    const base = new URL(options.baseUrl);
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new TypeError("baseUrl must be an HTTP(S) URL without credentials, query, or fragment.");
    }
    if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(base.hostname)) {
      throw new TypeError("HTTPS is required for non-local AgentLogin API URLs.");
    }
    if (!options.clientId.startsWith("al_client_") || !options.clientSecret.startsWith("al_secret_")) {
      throw new TypeError("A valid AgentLogin client ID and client secret are required.");
    }
    this.baseUrl = new URL(base.toString().endsWith("/") ? base.toString() : base.toString() + "/");
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) {
      throw new RangeError("timeoutMs must be an integer between 1 and 120000.");
    }
  }

  async registerAgent(input: { name: string; identity_type: string }, options: RequestOptions = {}): Promise<RegisteredAgent> {
    if (!input.name?.trim() || input.name.trim().length > 120 ||
        !input.identity_type?.trim() || input.identity_type.trim().length > 50) {
      throw new TypeError("Agent name and identity_type are required.");
    }
    const token = await this.getAccessToken(options);
    const response = await this.fetcher(new URL("v1/app/agents", this.baseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: input.name.trim(), identity_type: input.identity_type.trim() }),
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs)
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw safeError(response, payload as ErrorPayload);
    const credential = payload.credential as Record<string, unknown> | undefined;
    if (typeof payload.agent_id !== "string" || typeof credential?.token !== "string" ||
        typeof credential.expires_at !== "string" || credential.display_once !== true) {
      throw new AgentLoginApiError("AgentLogin returned an invalid agent registration response.", 502, "invalid_response");
    }
    return {
      agent_id: payload.agent_id,
      credential: { token: credential.token, expires_at: credential.expires_at, display_once: true }
    };
  }

  private async getAccessToken(options: RequestOptions): Promise<string> {
    if (this.accessToken && this.accessTokenExpiresAt > Date.now() + 30_000) return this.accessToken;
    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`, "utf8").toString("base64");
    const body = new URLSearchParams({ grant_type: "client_credentials" });
    const response = await this.fetcher(new URL("oauth/token", this.baseUrl), {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs)
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw safeError(response, { error: {
      code: typeof payload.error === "string" ? payload.error : "oauth_token_failed",
      message: typeof payload.error_description === "string" ? payload.error_description : "Application authentication failed."
    } });
    if (typeof payload.access_token !== "string" || payload.token_type !== "Bearer" ||
        typeof payload.expires_in !== "number" || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) {
      throw new AgentLoginApiError("AgentLogin returned an invalid OAuth token response.", 502, "invalid_response");
    }
    this.accessToken = payload.access_token;
    this.accessTokenExpiresAt = Date.now() + payload.expires_in * 1000;
    return this.accessToken;
  }
}


export type WebhookEventType =
  | "account.connected" | "account.connection_updated" | "account.disconnected"
  | "grant.requested" | "grant.approval_required" | "grant.approved" | "grant.denied"
  | "grant.revoked" | "grant.expired" | "execution.started" | "execution.completed"
  | "execution.failed";

export type WebhookEndpoint = {
  endpoint_id: string;
  url: string;
  event_types: WebhookEventType[];
  status: "active" | "disabled";
  secret_version: number;
  created_at: string;
  updated_at: string;
};

export type CreateWebhookEndpointInput = {
  url: string;
  event_types: WebhookEventType[];
};

export type CreatedWebhookEndpoint = {
  endpoint_id: string;
  url: string;
  event_types: WebhookEventType[];
  status: "active";
  signing_secret: string;
  secret_version: number;
  warning: string;
};

export type WebhookDelivery = {
  delivery_id: string;
  endpoint_id: string;
  endpoint_url: string;
  event_id: string;
  event_type: WebhookEventType;
  resource_type: string;
  resource_id: string;
  status: "pending" | "leased" | "delivered" | "dead_lettered" | "cancelled";
  attempt_count: number;
  next_attempt_at: string | null;
  delivered_at: string | null;
  dead_lettered_at: string | null;
  created_at: string;
};

export type WebhookDeliveryAttempt = {
  attempt_id: string;
  attempt_number: number;
  outcome: "succeeded" | "retryable_failure" | "permanent_failure" | "timeout";
  http_status: number | null;
  latency_ms: number | null;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
};

export type DeveloperAccessTokenProvider = () => string | Promise<string>;

export type AgentLoginDeveloperClientOptions = {
  baseUrl: string;
  accessTokenProvider: DeveloperAccessTokenProvider;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/**
 * OIDC-user-authenticated developer workspace client. Use only from a trusted
 * server or dashboard backend; never expose the access token or webhook
 * signing secret in browser bundles, logs, or telemetry.
 */
export class AgentLoginDeveloperClient {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: AgentLoginDeveloperClientOptions) {
    const base = new URL(options.baseUrl);
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new TypeError("baseUrl must be an HTTP(S) URL without credentials, query, or fragment.");
    }
    if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(base.hostname)) {
      throw new TypeError("HTTPS is required for non-local AgentLogin API URLs.");
    }
    if (typeof options.accessTokenProvider !== "function") {
      throw new TypeError("An OIDC accessTokenProvider is required.");
    }
    this.baseUrl = new URL(base.toString().endsWith("/") ? base.toString() : base.toString() + "/");
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) {
      throw new RangeError("timeoutMs must be an integer between 1 and 120000.");
    }
  }

  async listWebhookEndpoints(developerId: string, options: RequestOptions = {}): Promise<WebhookEndpoint[]> {
    const result = await this.request("GET", this.path(developerId, "webhook-endpoints"), undefined, options);
    const endpoints = (result as { endpoints?: unknown })?.endpoints;
    if (!Array.isArray(endpoints)) throw new AgentLoginApiError("AgentLogin returned an invalid endpoint list.", 502, "invalid_response");
    return endpoints as WebhookEndpoint[];
  }

  async createWebhookEndpoint(
    developerId: string,
    input: CreateWebhookEndpointInput,
    options: RequestOptions = {}
  ): Promise<CreatedWebhookEndpoint> {
    if (!input.url || !Array.isArray(input.event_types) || input.event_types.length === 0) {
      throw new TypeError("A webhook URL and at least one event type are required.");
    }
    const result = await this.request("POST", this.path(developerId, "webhook-endpoints"), input, options);
    const endpoint = result as Partial<CreatedWebhookEndpoint>;
    if (typeof endpoint.endpoint_id !== "string" || typeof endpoint.signing_secret !== "string" ||
        endpoint.status !== "active" || endpoint.warning === undefined) {
      throw new AgentLoginApiError("AgentLogin returned an invalid one-time webhook secret response.", 502, "invalid_response");
    }
    return endpoint as CreatedWebhookEndpoint;
  }

  async updateWebhookEndpoint(
    developerId: string,
    endpointId: string,
    input: { url?: string; event_types?: WebhookEventType[]; status?: "active" | "disabled" },
    options: RequestOptions = {}
  ): Promise<{ endpoint_id: string; status: "active" | "disabled" }> {
    return await this.request("PATCH", this.path(developerId, "webhook-endpoints") + "/" + encodeURIComponent(endpointId), input, options) as {
      endpoint_id: string; status: "active" | "disabled";
    };
  }

  async disableWebhookEndpoint(developerId: string, endpointId: string, options: RequestOptions = {}): Promise<void> {
    await this.request("DELETE", this.path(developerId, "webhook-endpoints") + "/" + encodeURIComponent(endpointId), undefined, options);
  }

  async listWebhookDeliveries(
    developerId: string,
    query: { limit?: number; status?: WebhookDelivery["status"]; endpoint_id?: string } = {},
    options: RequestOptions = {}
  ): Promise<WebhookDelivery[]> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.status !== undefined) params.set("status", query.status);
    if (query.endpoint_id !== undefined) params.set("endpoint_id", query.endpoint_id);
    const suffix = params.size ? "?" + params.toString() : "";
    const result = await this.request("GET", this.path(developerId, "webhook-deliveries") + suffix, undefined, options);
    const deliveries = (result as { deliveries?: unknown })?.deliveries;
    if (!Array.isArray(deliveries)) throw new AgentLoginApiError("AgentLogin returned an invalid delivery list.", 502, "invalid_response");
    return deliveries as WebhookDelivery[];
  }

  async testWebhookEndpoint(
    developerId: string,
    endpointId: string,
    options: RequestOptions = {}
  ): Promise<{ event_id: string; delivery_id: string; status: "pending"; message: string }> {
    const path = this.path(developerId, "webhook-endpoints") + "/" +
      encodeURIComponent(endpointId) + "/test";
    return await this.request("POST", path, {}, options) as {
      event_id: string; delivery_id: string; status: "pending"; message: string;
    };
  }

  async replayWebhookDelivery(
    developerId: string,
    deliveryId: string,
    options: RequestOptions = {}
  ): Promise<{ delivery_id: string; status: "pending"; attempt_count: number; next_attempt_at: string }> {
    const path = this.path(developerId, "webhook-deliveries") + "/" +
      encodeURIComponent(deliveryId) + "/replay";
    return await this.request("POST", path, {}, options) as {
      delivery_id: string; status: "pending"; attempt_count: number; next_attempt_at: string;
    };
  }

  async listWebhookDeliveryAttempts(
    developerId: string,
    deliveryId: string,
    options: RequestOptions = {}
  ): Promise<WebhookDeliveryAttempt[]> {
    const path = this.path(developerId, "webhook-deliveries") + "/" +
      encodeURIComponent(deliveryId) + "/attempts";
    const result = await this.request("GET", path, undefined, options);
    const attempts = (result as { attempts?: unknown })?.attempts;
    if (!Array.isArray(attempts)) throw new AgentLoginApiError("AgentLogin returned an invalid delivery-attempt list.", 502, "invalid_response");
    return attempts as WebhookDeliveryAttempt[];
  }

  private path(developerId: string, resource: string): string {
    if (!developerId || developerId.trim() !== developerId || developerId.length > 200) {
      throw new TypeError("developerId must be a non-empty developer identifier.");
    }
    return "v1/developers/" + encodeURIComponent(developerId) + "/" + resource;
  }

  private async request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    options: RequestOptions
  ): Promise<unknown> {
    const token = await this.options.accessTokenProvider();
    if (typeof token !== "string" || !token.trim()) throw new TypeError("The accessTokenProvider returned an empty token.");
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      method,
      headers: {
        authorization: "Bearer " + token,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    if (response.status === 204) return undefined;
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = payload && typeof payload === "object" ? payload as ErrorPayload : {};
      throw safeError(response, parsed);
    }
    return payload;
  }
}
