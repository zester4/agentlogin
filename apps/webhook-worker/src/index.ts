import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { AwsKmsProvider, decryptCredential, type CiphertextEnvelope, type CredentialContext } from "@agentlogin/vault";
import { postWebhookSafely } from "@agentlogin/webhooks";

type QueueItem = { tenant_id: string; delivery_id: string; lease_token: string };
type ClaimedDelivery = {
  tenant_id: string; delivery_id: string; endpoint_id: string; event_id: string;
  attempt_count: number; max_attempts: number; url: string; secret_ciphertext: Buffer;
  secret_iv: Buffer; secret_auth_tag: Buffer; wrapped_dek: Buffer; key_version: string;
  secret_version: number; event_type: string; resource_type: string; resource_id: string;
  occurred_at: Date; payload: Record<string, unknown>;
};

const enabled = process.env.WEBHOOK_WORKER_ENABLED === "true";
const databaseUrl = process.env.DATABASE_URL;
const kmsKeyId = process.env.AWS_KMS_KEY_ID;
const awsRegion = process.env.AWS_REGION;
if (!enabled) {
  process.stdout.write("Webhook worker is disabled; waiting without polling the queue.\n");
  let disabled = true;
  const stopDisabled = () => { disabled = false; };
  process.on("SIGTERM", stopDisabled);
  process.on("SIGINT", stopDisabled);
  while (disabled) await new Promise((resolve) => setTimeout(resolve, 30_000));
  process.exit(0);
}
if (!databaseUrl || !kmsKeyId || !awsRegion) {
  throw new Error("Webhook worker configuration is incomplete.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.WEBHOOK_WORKER_POOL_MAX ?? 4),
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  application_name: "agentlogin-webhook-worker"
});
const kms = new AwsKmsProvider(kmsKeyId, awsRegion);
let stopping = false;

async function inTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimDueDeliveries(limit = 10): Promise<QueueItem[]> {
  return inTransaction(async (client) => {
    const selected = await client.query<QueueItem>(
      "SELECT tenant_id, delivery_id, lease_token FROM public.claim_webhook_delivery_queue($1)",
      [limit]
    );
    return selected.rows;
  });
}

async function loadDelivery(item: QueueItem): Promise<ClaimedDelivery | null> {
  return inTransaction(async (client) => {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [item.tenant_id]);
    const result = await client.query<ClaimedDelivery>(
      `SELECT d.tenant_id, d.id AS delivery_id, d.endpoint_id, d.event_id,
              d.attempt_count, d.max_attempts, e.url,
              e.secret_ciphertext, e.secret_iv, e.secret_auth_tag, e.wrapped_dek,
              e.key_version, e.secret_version,
              v.event_type, v.resource_type, v.resource_id, v.occurred_at, v.payload
         FROM webhook_deliveries d
         JOIN webhook_endpoints e
           ON e.tenant_id = d.tenant_id AND e.id = d.endpoint_id
         JOIN webhook_events v
           ON v.tenant_id = d.tenant_id AND v.id = d.event_id
         JOIN webhook_delivery_queue q
           ON q.tenant_id = d.tenant_id AND q.delivery_id = d.id
        WHERE d.tenant_id = $1 AND d.id = $2
          AND q.lease_token = $3 AND e.status = 'active'
        FOR UPDATE OF d, q`,
      [item.tenant_id, item.delivery_id, item.lease_token]
    );
    const row = result.rows[0];
    if (!row) {
      await client.query(
        `UPDATE webhook_deliveries
            SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status IN ('pending', 'leased')
            AND EXISTS (
              SELECT 1 FROM webhook_delivery_queue
               WHERE tenant_id = $1 AND delivery_id = $2 AND lease_token = $3
            )`,
        [item.tenant_id, item.delivery_id, item.lease_token]
      );
      await client.query(
        "SELECT public.complete_webhook_delivery_queue($1, $2, $3, NULL, true)",
        [item.tenant_id, item.delivery_id, item.lease_token]
      );
      return null;
    }
    await client.query(
      `UPDATE webhook_deliveries
          SET status = 'leased', lease_token = $3,
              lease_expires_at = now() + interval '45 seconds', updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [item.tenant_id, item.delivery_id, item.lease_token]
    );
    return row;
  });
}

function retryDelayMs(attemptNumber: number): number {
  return Math.min(6 * 60 * 60 * 1000, 5_000 * (2 ** Math.min(attemptNumber - 1, 16)));
}

async function recordOutcome(
  item: QueueItem,
  delivery: ClaimedDelivery,
  outcome: "succeeded" | "retryable_failure" | "permanent_failure" | "timeout",
  httpStatus: number | null,
  latencyMs: number,
  responseSummary: string | null,
  errorCode: string | null
): Promise<void> {
  await inTransaction(async (client) => {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [item.tenant_id]);
    const attemptNumber = delivery.attempt_count + 1;
    const exhausted = attemptNumber >= delivery.max_attempts;
    const finalFailure = outcome === "permanent_failure" || exhausted;
    const finalSuccess = outcome === "succeeded";
    const final = finalSuccess || finalFailure;
    await client.query(
      `INSERT INTO webhook_delivery_attempts
         (id, tenant_id, delivery_id, attempt_number, outcome, http_status,
          latency_ms, response_summary, error_code, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
      [randomUUID(), item.tenant_id, item.delivery_id, attemptNumber, outcome,
       httpStatus, Math.max(0, latencyMs), responseSummary, errorCode]
    );
    await client.query(
      `UPDATE webhook_deliveries
          SET attempt_count = $3,
              status = CASE WHEN $4 THEN 'delivered'
                            WHEN $5 THEN 'dead_lettered'
                            ELSE 'pending' END,
              delivered_at = CASE WHEN $4 THEN now() ELSE NULL END,
              dead_lettered_at = CASE WHEN $5 THEN now() ELSE NULL END,
              lease_token = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND lease_token = $6`,
      [item.tenant_id, item.delivery_id, attemptNumber, finalSuccess, finalFailure, item.lease_token]
    );
    if (final) {
      await client.query(
        "SELECT public.complete_webhook_delivery_queue($1, $2, $3, NULL, true)",
        [item.tenant_id, item.delivery_id, item.lease_token]
      );
    } else {
      await client.query(
        "SELECT public.complete_webhook_delivery_queue($1, $2, $3, now() + ($4::bigint * interval '1 millisecond'), false)",
        [item.tenant_id, item.delivery_id, item.lease_token, retryDelayMs(attemptNumber)]
      );
    }
  });
}

async function deliver(item: QueueItem): Promise<void> {
  const delivery = await loadDelivery(item);
  if (!delivery) return;
  const context: CredentialContext = {
    tenantId: delivery.tenant_id,
    accountId: delivery.endpoint_id,
    credentialId: delivery.endpoint_id,
    recordVersion: delivery.secret_version,
    purpose: "webhook_signing_secret"
  };
  const envelope: CiphertextEnvelope = {
    algorithm: "AES-256-GCM",
    ciphertext: delivery.secret_ciphertext,
    iv: delivery.secret_iv,
    authTag: delivery.secret_auth_tag,
    wrappedDek: delivery.wrapped_dek,
    keyVersion: delivery.key_version,
    aadVersion: 1
  };
  let secret: Buffer | undefined;
  let body: Buffer | undefined;
  try {
    secret = await decryptCredential(envelope, context, kms);
    body = Buffer.from(JSON.stringify({
      id: delivery.event_id,
      type: delivery.event_type,
      occurred_at: new Date(delivery.occurred_at).toISOString(),
      resource: { type: delivery.resource_type, id: delivery.resource_id },
      data: delivery.payload
    }));
    const result = await postWebhookSafely({
      url: delivery.url,
      body,
      secret,
      eventId: delivery.event_id,
      deliveryId: delivery.delivery_id
    });
    await recordOutcome(
      item, delivery, result.outcome, result.statusCode, result.latencyMs,
      `HTTP ${result.statusCode}`, null
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.message.toLowerCase().includes("timed out");
    const destinationRejected = error instanceof Error &&
      (error.message.includes("destination") || error.message.includes("resolves to a prohibited address"));
    await recordOutcome(
      item, delivery,
      destinationRejected ? "permanent_failure" : timedOut ? "timeout" : "retryable_failure",
      null, 0, null, destinationRejected ? "destination_rejected" : "delivery_transport_error"
    );
  } finally {
    body?.fill(0);
    secret?.fill(0);
  }
}

async function run(): Promise<void> {
  process.stdout.write("Webhook delivery worker started.\n");
  while (!stopping) {
    try {
      const items = await claimDueDeliveries();
      for (const item of items) {
        if (stopping) break;
        await deliver(item);
      }
      if (items.length === 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
    } catch {
      // Never log request payloads, URLs, headers, signing secrets, or provider errors.
      process.stderr.write("Webhook worker cycle failed; retrying safely.\n");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  await pool.end();
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
await run();
