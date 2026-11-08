import {
  AgentIdentitySchema,
  GrantRequestSchema,
  PendingGrantSchema,
  type AgentIdentity,
  type GrantRequest,
  type PendingGrant
} from "@agentlogin/contracts";

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
