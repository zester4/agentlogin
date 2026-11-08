import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import type { LookupFunction } from "node:net";

export type SafeWebhookResult = {
  statusCode: number;
  latencyMs: number;
  responseBytes: number;
  outcome: "succeeded" | "retryable_failure" | "permanent_failure";
};

export function signWebhookBody(secret: Uint8Array, timestampSeconds: number, body: Uint8Array): string {
  if (secret.byteLength < 32 || !Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
    throw new TypeError("Invalid webhook signing input.");
  }
  const digest = createHmac("sha256", secret)
    .update(String(timestampSeconds), "utf8")
    .update(".", "utf8")
    .update(body)
    .digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

export function verifyWebhookSignature(
  secret: Uint8Array, timestampSeconds: number, body: Uint8Array, signature: string
): boolean {
  try {
    const expected = signWebhookBody(secret, timestampSeconds, body);
    const actual = Buffer.from(signature, "utf8");
    const target = Buffer.from(expected, "utf8");
    return actual.byteLength === target.byteLength && timingSafeEqual(actual, target);
  } catch {
    return false;
  }
}

function ipv4Number(address: string): number {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error("Invalid IPv4 address.");
  }
  return (((parts[0]! * 256 + parts[1]!) * 256 + parts[2]!) * 256 + parts[3]!);
}

function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const n = ipv4Number(address);
  const ranges: Array<[number, number]> = [
    [ipv4Number("0.0.0.0"), ipv4Number("0.255.255.255")],
    [ipv4Number("10.0.0.0"), ipv4Number("10.255.255.255")],
    [ipv4Number("100.64.0.0"), ipv4Number("100.127.255.255")],
    [ipv4Number("127.0.0.0"), ipv4Number("127.255.255.255")],
    [ipv4Number("169.254.0.0"), ipv4Number("169.254.255.255")],
    [ipv4Number("172.16.0.0"), ipv4Number("172.31.255.255")],
    [ipv4Number("192.0.0.0"), ipv4Number("192.0.0.255")],
    [ipv4Number("192.0.2.0"), ipv4Number("192.0.2.255")],
    [ipv4Number("192.88.99.0"), ipv4Number("192.88.99.255")],
    [ipv4Number("192.168.0.0"), ipv4Number("192.168.255.255")],
    [ipv4Number("198.18.0.0"), ipv4Number("198.19.255.255")],
    [ipv4Number("198.51.100.0"), ipv4Number("198.51.100.255")],
    [ipv4Number("203.0.113.0"), ipv4Number("203.0.113.255")],
    [ipv4Number("224.0.0.0"), ipv4Number("255.255.255.255")]
  ];
  return !ranges.some(([start, end]) => n >= start && n <= end);
}

async function resolvePinnedIpv4(hostname: string): Promise<string> {
  if (isIP(hostname)) {
    if (!isPublicIpv4(hostname)) throw new Error("Webhook destination is not a public IPv4 address.");
    return hostname;
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => !isPublicIpv4(record.address))) {
    throw new Error("Webhook hostname resolves to a prohibited address.");
  }
  return records[0]!.address;
}

export async function postWebhookSafely(input: {
  url: string;
  body: Uint8Array;
  secret: Uint8Array;
  eventId: string;
  deliveryId: string;
  timestampSeconds?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}): Promise<SafeWebhookResult> {
  const parsed = new URL(input.url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      !parsed.hostname || (parsed.port && parsed.port !== "443") ||
      parsed.hash || parsed.hostname.endsWith(".")) {
    throw new Error("Webhook destination must be a credential-free HTTPS URL on port 443.");
  }
  if (input.body.byteLength > 256 * 1024 || !input.eventId || !input.deliveryId) {
    throw new Error("Webhook request exceeds the allowed size or is missing identifiers.");
  }
  const timestamp = input.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const pinnedAddress = await resolvePinnedIpv4(parsed.hostname);
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? 10_000;
  const maxResponseBytes = input.maxResponseBytes ?? 32 * 1024;
  const lookupPinned: LookupFunction = (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, [{ address: pinnedAddress, family: 4 }]);
    } else {
      callback(null, pinnedAddress, 4);
    }
  };

  return new Promise((resolve, reject) => {
    let responseBytes = 0;
    const request = https.request({
      protocol: "https:",
      hostname: parsed.hostname,
      port: 443,
      method: "POST",
      path: parsed.pathname + parsed.search,
      servername: parsed.hostname,
      lookup: lookupPinned,
      timeout: timeoutMs,
      headers: {
        "content-type": "application/json",
        "content-length": String(input.body.byteLength),
        "user-agent": "AgentLogin-Webhooks/1.0",
        "x-agentlogin-event-id": input.eventId,
        "x-agentlogin-delivery-id": input.deliveryId,
        "x-agentlogin-timestamp": String(timestamp),
        "x-agentlogin-signature": signWebhookBody(input.secret, timestamp, input.body)
      }
    }, (response) => {
      response.on("data", (chunk: Buffer) => {
        responseBytes += chunk.byteLength;
        if (responseBytes > maxResponseBytes) {
          response.destroy(new Error("Webhook response exceeded the configured limit."));
        }
      });
      response.on("error", reject);
      response.on("end", () => {
        const statusCode = response.statusCode ?? 0;
        resolve({
          statusCode,
          latencyMs: Date.now() - started,
          responseBytes,
          outcome: statusCode >= 200 && statusCode < 300
            ? "succeeded"
            : statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500
              ? "retryable_failure" : "permanent_failure"
        });
      });
    });
    request.on("timeout", () => request.destroy(new Error("Webhook request timed out.")));
    request.on("error", reject);
    request.end(Buffer.from(input.body));
  });
}
