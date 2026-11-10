import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import {
  createDatabase,
  PostgresCredentialRecordStore
} from "@agentlogin/database";
import {
  decodeWorkerTicketSigningKey,
  verifyWorkerTicket
} from "@agentlogin/execution";
import { AwsKmsProvider, EncryptedCredentialVault, getAwsCallerIdentity } from "@agentlogin/vault";

const ExecutionBody = z.object({
  executionId: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
  grantId: z.string().min(1).max(200),
  accountRef: z.string().min(1).max(200),
  expectedOrigin: z.string().url().max(2048),
  credentialId: z.string().min(1).max(200),
  recordVersion: z.number().int().positive(),
  taskId: z.string().min(1).max(200).optional(),
  credentialLease: z.object({
    leaseId: z.string().min(1).max(200),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAt: z.string().datetime()
  }).strict(),
  deadline: z.string().datetime()
}).strict();

type ExecutionInput = z.infer<typeof ExecutionBody>;
type SafeOutcome =
  | { status: "login_succeeded" }
  | { status: "login_failed"; reasonCode: "invalid_credentials" | "site_unavailable" | "unsupported_flow" | "challenge_detected" };

type BrokerReceipt = {
  lease_id: string;
  execution_id: string;
  account_id: string;
  origin: string;
  credential_ref: string;
  credential_id: string;
  record_version: number;
};

type Credentials = { username: string; password: string };
type ActiveExecution = { browser: Browser; context: BrowserContext };

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const n = (((parts[0]! * 256 + parts[1]!) * 256 + parts[2]!) * 256 + parts[3]!) >>> 0;
  const ranges: Array<[number, number]> = [
    [0x00000000, 0x00ffffff], [0x0a000000, 0x0affffff],
    [0x64400000, 0x647fffff], [0x7f000000, 0x7fffffff],
    [0xa9fe0000, 0xa9feffff], [0xac100000, 0xac1fffff],
    [0xc0000000, 0xc00000ff], [0xc0000200, 0xc00002ff],
    [0xc0a80000, 0xc0a8ffff], [0xc6120000, 0xc613ffff],
    [0xc6336400, 0xc63364ff], [0xcb007100, 0xcb0071ff],
    [0xe0000000, 0xffffffff]
  ];
  return ranges.some(([start, end]) => n >= start && n <= end);
}

async function resolvePublicIpv4(hostname: string): Promise<string> {
  if (process.env.NODE_ENV !== "production" && ["127.0.0.1", "localhost"].includes(hostname)) {
    return "127.0.0.1";
  }
  if (isIP(hostname) === 4) {
    if (isPrivateIpv4(hostname)) throw new Error("private_target_blocked");
    return hostname;
  }
  if (isIP(hostname) !== 0 || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("private_target_blocked");
  }
  const records = await lookup(hostname, { all: true, family: 4, verbatim: true });
  if (!records.length || records.some((record) => isPrivateIpv4(record.address))) {
    throw new Error("private_target_blocked");
  }
  return records[0]!.address;
}

function parseOrigin(value: string): URL {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" &&
        url.protocol === "http:" && ["127.0.0.1", "::1", "localhost"].includes(url.hostname)))) {
    throw new Error("invalid_origin");
  }
  return url;
}

function parseApiUrl(value: string): URL {
  const url = new URL(value);
  const privateRailway = url.hostname.endsWith(".railway.internal");
  const local = process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !(url.protocol === "https:" || (url.protocol === "http:" && (privateRailway || local)))) {
    throw new Error("AGENTLOGIN_API_INTERNAL_URL must be HTTPS or a trusted Railway private URL.");
  }
  return url;
}

function decodeCredentials(secret: Uint8Array): Credentials {
  const copy = Buffer.from(secret);
  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(copy.toString("utf8"));
  } finally {
    copy.fill(0);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("invalid_credential_record");
  const value = parsed as Record<string, unknown>;
  if (typeof value.username !== "string" || !value.username ||
      typeof value.password !== "string" || !value.password) {
    throw new Error("invalid_credential_record");
  }
  return { username: value.username, password: value.password };
}

async function consumeLease(
  apiUrl: URL,
  ticket: string,
  leaseId: string,
  leaseToken: string
): Promise<BrokerReceipt> {
  const response = await fetch(new URL("/internal/v1/credential-leases/consume", apiUrl), {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: "Bearer " + ticket,
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify({ lease_id: leaseId, token: leaseToken }),
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error("credential_lease_unavailable");
  const data: unknown = await response.json();
  const parsed = z.object({
    lease_id: z.string(), execution_id: z.string(), account_id: z.string(),
    origin: z.string().url(), credential_ref: z.string(), credential_id: z.string(),
    record_version: z.number().int().positive()
  }).strict().safeParse(data);
  if (!parsed.success) throw new Error("invalid_broker_response");
  return parsed.data;
}

async function hasLocator(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).count().then((count) => count > 0).catch(() => false);
}

async function runBrowserLogin(
  input: ExecutionInput,
  credentials: Credentials,
  active: Map<string, ActiveExecution>,
  reservations: Set<string>
): Promise<SafeOutcome> {
  const origin = parseOrigin(input.expectedOrigin);
  const pinnedIp = await resolvePublicIpv4(origin.hostname);
  const remaining = new Date(input.deadline).getTime() - Date.now();
  if (remaining <= 0 || remaining > 120_000) return { status: "login_failed", reasonCode: "site_unavailable" };

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--no-first-run",
      `--host-resolver-rules=MAP ${origin.hostname} ${pinnedIp},EXCLUDE localhost`
    ]
  });
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      javaScriptEnabled: true,
      ignoreHTTPSErrors: false,
      viewport: { width: 1280, height: 800 }
    });
    active.set(input.executionId, { browser, context });
    reservations.delete(input.executionId);
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      try {
        const target = new URL(route.request().url());
        if (target.origin !== origin.origin || !["http:", "https:"].includes(target.protocol)) {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });

    await page.goto(origin.origin, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(12_000, remaining)
    });

    const passwordSelector = 'input[type="password"], input[autocomplete="current-password"]';
    let hasPassword = await hasLocator(page, passwordSelector);
    if (!hasPassword) {
      const loginLink = page.getByRole("link", { name: /sign in|log in|login/i }).first();
      if (await loginLink.count().catch(() => 0)) {
        await loginLink.click({ timeout: 3_000 }).catch(() => undefined);
        await page.waitForLoadState("domcontentloaded", { timeout: 3_000 }).catch(() => undefined);
      }
      if (!await hasLocator(page, passwordSelector)) {
        const loginPath = new URL("/login", origin.origin);
        await page.goto(loginPath.toString(), { waitUntil: "domcontentloaded", timeout: Math.min(8_000, remaining) });
      }
      hasPassword = await hasLocator(page, passwordSelector);
    }
    if (!hasPassword) return { status: "login_failed", reasonCode: "unsupported_flow" };

    const username = page.locator(
      'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[name*="email" i]'
    ).first();
    const password = page.locator(passwordSelector).first();
    if (!await username.count().catch(() => 0)) {
      return { status: "login_failed", reasonCode: "unsupported_flow" };
    }

    await username.fill(credentials.username, { timeout: 4_000 });
    await password.fill(credentials.password, { timeout: 4_000 });
    const submit = page.locator('button[type="submit"], input[type="submit"]').first();
    if (await submit.count().catch(() => 0)) {
      await submit.click({ timeout: 5_000 });
    } else {
      await password.press("Enter", { timeout: 3_000 });
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(500);

    if (await hasLocator(page, 'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="verification" i]')) {
      return { status: "login_failed", reasonCode: "challenge_detected" };
    }

    const bodyText = (await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "")).toLowerCase();
    if (/invalid (email|username|password|credentials)|incorrect (password|credentials)|wrong password|try again/.test(bodyText) &&
        await hasLocator(page, passwordSelector)) {
      return { status: "login_failed", reasonCode: "invalid_credentials" };
    }

    const passwordStillVisible = await hasLocator(page, passwordSelector);
    const positiveSignal = /signed in|log out|sign out|dashboard|my account|welcome/.test(bodyText);
    if (!passwordStillVisible && positiveSignal) return { status: "login_succeeded" };
    return { status: "login_failed", reasonCode: "unsupported_flow" };
  } finally {
    active.delete(input.executionId);
    if (context) await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export function buildWorkerApp(options: {
  signingKey: Uint8Array;
  apiUrl: URL;
  database: ReturnType<typeof createDatabase>;
  kms: AwsKmsProvider;
  maxConcurrent?: number;
}) {
  const app: FastifyInstance = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: { paths: ["req.headers.authorization", "req.body.credentialLease.token", "req.body.password"], censor: "[REDACTED]" }
    },
    bodyLimit: 16_384
  });
  const active = new Map<string, ActiveExecution>();
  const reservations = new Set<string>();
  const maxConcurrent = options.maxConcurrent ?? 2;
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 10) {
    throw new TypeError("Worker concurrency must be between 1 and 10.");
  }

  app.get("/health", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return reply.send({ status: "ok", service: "agentlogin-isolated-worker" });
  });

  app.post("/internal/v1/executions/login", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = request.headers.authorization;
    if (typeof auth !== "string" || !auth.startsWith("Bearer ") || auth.length > 2100) {
      return reply.code(401).send({ error: { code: "worker_unauthorized" } });
    }
    let claims: ReturnType<typeof verifyWorkerTicket>;
    try {
      claims = verifyWorkerTicket(auth.slice(7), options.signingKey);
    } catch {
      return reply.code(401).send({ error: { code: "worker_unauthorized" } });
    }
    const parsed = ExecutionBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "invalid_execution_request" } });
    const input = parsed.data;
    if (claims.executionId !== input.executionId || claims.tenantId !== input.tenantId ||
        claims.leaseId !== input.credentialLease.leaseId ||
        input.deadline <= new Date().toISOString() ||
        new Date(input.deadline).getTime() > Date.now() + 120_000) {
      return reply.code(403).send({ error: { code: "execution_ticket_mismatch" } });
    }
    if (active.has(input.executionId) || reservations.has(input.executionId)) {
      return reply.code(409).send({ error: { code: "execution_already_active" } });
    }
    if (active.size + reservations.size >= maxConcurrent) {
      return reply.code(429).send({ error: { code: "worker_at_capacity" } });
    }

    reservations.add(input.executionId);
    try {
      const receipt = await consumeLease(
        options.apiUrl, auth.slice(7), input.credentialLease.leaseId, input.credentialLease.token
      );
      if (receipt.lease_id !== claims.leaseId || receipt.execution_id !== claims.executionId ||
          receipt.account_id !== input.accountRef || receipt.origin !== input.expectedOrigin ||
          receipt.credential_id !== input.credentialId || receipt.record_version !== input.recordVersion) {
        return reply.code(403).send({ error: { code: "credential_lease_binding_mismatch" } });
      }

      const vault = new EncryptedCredentialVault(
        new PostgresCredentialRecordStore(options.database.db, claims.tenantId),
        options.kms
      );
      const context = {
        tenantId: claims.tenantId,
        accountId: receipt.account_id,
        credentialId: receipt.credential_id,
        recordVersion: receipt.record_version,
        purpose: "website_login" as const
      };
      try {
        const result = await vault.withDecryptedCredential(receipt.credential_ref, context, async (secret) => {
          const credentials = decodeCredentials(secret);
          try {
            return await runBrowserLogin(input, credentials, active, reservations);
          } finally {
            credentials.username = "";
            credentials.password = "";
          }
        });
        return reply.code(200).send(result);
      } catch (error) {
        request.log.warn({ executionId: claims.executionId, errorName: error instanceof Error ? error.name : "UnknownError" }, "isolated login execution failed");
        return reply.code(200).send({ status: "login_failed", reasonCode: "site_unavailable" });
      }
    } catch {
      return reply.code(403).send({ error: { code: "credential_lease_unavailable" } });
    } finally {
      reservations.delete(input.executionId);
    }
  });

  app.post("/internal/v1/executions/:executionId/terminate", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const auth = request.headers.authorization;
    if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return reply.code(401).send({ error: { code: "worker_unauthorized" } });
    let claims: ReturnType<typeof verifyWorkerTicket>;
    try { claims = verifyWorkerTicket(auth.slice(7), options.signingKey); }
    catch { return reply.code(401).send({ error: { code: "worker_unauthorized" } }); }
    const executionId = (request.params as { executionId: string }).executionId;
    if (claims.executionId !== executionId) return reply.code(403).send({ error: { code: "execution_ticket_mismatch" } });
    const execution = active.get(executionId);
    if (execution) {
      active.delete(executionId);
      await execution.context.close().catch(() => undefined);
      await execution.browser.close().catch(() => undefined);
    }
    return reply.send({ terminated: Boolean(execution) });
  });

  app.addHook("onClose", async () => {
    await Promise.all([...active.values()].map(async (execution) => {
      await execution.context.close().catch(() => undefined);
      await execution.browser.close().catch(() => undefined);
    }));
    await options.database.close();
  });
  return app;
}

const port = Number(process.env.PORT ?? 4180);
const signingKey = decodeWorkerTicketSigningKey(process.env.AGENTLOGIN_WORKER_TICKET_SIGNING_KEY);
const apiUrlValue = process.env.AGENTLOGIN_API_INTERNAL_URL;
const databaseUrl = process.env.DATABASE_URL;
const kmsKeyId = process.env.AWS_KMS_KEY_ID;
const awsRegion = process.env.AWS_REGION;

if (process.env.NODE_ENV !== "test") {
  if (!signingKey || !apiUrlValue || !databaseUrl || !kmsKeyId || !awsRegion) {
    throw new Error("Worker requires its dedicated ticket key, API URL, database URL, and KMS configuration.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid worker port.");
  const database = createDatabase(databaseUrl);
  const app = buildWorkerApp({
    signingKey,
    apiUrl: parseApiUrl(apiUrlValue),
    database,
    kms: new AwsKmsProvider(kmsKeyId, awsRegion)
  });
  try {
    const identity = await getAwsCallerIdentity(awsRegion);
    app.log.info({ awsCallerArn: identity.arn, awsAccountId: identity.account }, "worker AWS caller identity attested");
    await app.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error({ errorName: error instanceof Error ? error.name : "UnknownError" }, "worker startup failed");
    await app.close();
    process.exitCode = 1;
  }
}
