import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

const TEST_EMAIL = "agentlogin-test@example.com";
const TEST_PASSWORD = "agentlogin-synthetic-password";
const TEST_MFA_CODE = "246810";
const MAX_BODY_BYTES = 8_192;

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers
  });
  response.end(body);
}

function html(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · AgentLogin Synthetic Site</title>
  <style>
    body{font:16px system-ui,sans-serif;max-width:34rem;margin:10vh auto;padding:0 1.25rem;color:#17202a}
    main{border:1px solid #d8dee6;border-radius:14px;padding:1.5rem}
    label{display:block;margin:1rem 0 .35rem}input,button{box-sizing:border-box;width:100%;padding:.8rem;border:1px solid #9aa7b5;border-radius:8px;font:inherit}
    button{margin-top:1.2rem;background:#17202a;color:white;cursor:pointer}
    small{color:#52606d}.status{padding:.75rem;background:#eef3f7;border-radius:8px}
  </style>
</head>
<body><main><h1>${title}</h1>${body}<p><small>Synthetic test environment only. No real accounts or credentials.</small></p></main></body>
</html>`;
}

async function readForm(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function cookieValue(request, name) {
  const raw = request.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

export function createTestSiteServer() {
  const sessions = new Map();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return send(response, 200, JSON.stringify({ status: "ok", service: "agentlogin-synthetic-site" }), {
          "content-type": "application/json"
        });
      }

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/login")) {
        const scenario = url.searchParams.get("scenario") === "mfa" ? "mfa" : "success";
        return send(response, 200, html("Sign in", `
          <p class="status">Test scenario: ${scenario}</p>
          <form method="post" action="/login">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" autocomplete="username" required>
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required>
            <input type="hidden" name="scenario" value="${scenario}">
            <button type="submit">Sign in</button>
          </form>
        `), { "content-type": "text/html; charset=utf-8" });
      }

      if (request.method === "POST" && url.pathname === "/login") {
        const form = await readForm(request);
        if (!safeEqual(form.get("email") ?? "", TEST_EMAIL) ||
            !safeEqual(form.get("password") ?? "", TEST_PASSWORD)) {
          return send(response, 401, html("Sign-in failed", '<p class="status">Invalid email or password.</p><a href="/login">Try again</a>'), {
            "content-type": "text/html; charset=utf-8"
          });
        }
        const sessionId = randomBytes(24).toString("base64url");
        const needsMfa = form.get("scenario") === "mfa";
        sessions.set(sessionId, { authenticated: !needsMfa, mfaPending: needsMfa });
        const cookie = `agentlogin_test_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=300`;
        if (needsMfa) {
          return send(response, 200, html("Additional verification", `
            <p class="status">MFA is required to finish this synthetic login.</p>
            <form method="post" action="/mfa">
              <label for="code">Verification code</label>
              <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required>
              <button type="submit">Verify</button>
            </form>
          `), { "content-type": "text/html; charset=utf-8", "set-cookie": cookie });
        }
        return send(response, 200, html("Signed in", '<p class="status" data-testid="login-success">Synthetic account authenticated.</p><a href="/session">Check session</a>'), {
          "content-type": "text/html; charset=utf-8", "set-cookie": cookie
        });
      }

      if (request.method === "POST" && url.pathname === "/mfa") {
        const sessionId = cookieValue(request, "agentlogin_test_session");
        const session = sessions.get(sessionId);
        const form = await readForm(request);
        if (!session?.mfaPending || !safeEqual(form.get("code") ?? "", TEST_MFA_CODE)) {
          return send(response, 401, html("Verification failed", '<p class="status">Invalid or expired verification code.</p>'), {
            "content-type": "text/html; charset=utf-8"
          });
        }
        session.mfaPending = false;
        session.authenticated = true;
        return send(response, 200, html("Signed in", '<p class="status" data-testid="login-success">Synthetic account authenticated after MFA.</p><a href="/session">Check session</a>'), {
          "content-type": "text/html; charset=utf-8"
        });
      }

      if (request.method === "GET" && url.pathname === "/session") {
        const session = sessions.get(cookieValue(request, "agentlogin_test_session"));
        const result = { authenticated: session?.authenticated === true, mfa_required: session?.mfaPending === true };
        return send(response, 200, JSON.stringify(result), { "content-type": "application/json" });
      }

      if (request.method === "POST" && url.pathname === "/logout") {
        const sessionId = cookieValue(request, "agentlogin_test_session");
        sessions.delete(sessionId);
        return send(response, 200, JSON.stringify({ logged_out: true }), {
          "content-type": "application/json",
          "set-cookie": "agentlogin_test_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
        });
      }

      return send(response, 404, JSON.stringify({ error: "not_found" }), { "content-type": "application/json" });
    } catch (error) {
      const status = error instanceof Error && error.message === "body_too_large" ? 413 : 400;
      return send(response, status, JSON.stringify({ error: status === 413 ? "body_too_large" : "invalid_request" }), {
        "content-type": "application/json"
      });
    }
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The synthetic login site must never run in production.");
  }
  const host = process.env.TEST_SITE_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("The synthetic login site may bind only to loopback.");
  }
  const port = Number(process.env.TEST_SITE_PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid TEST_SITE_PORT.");
  const server = createTestSiteServer();
  server.listen(port, host, () => {
    process.stdout.write(`AgentLogin synthetic site listening at http://${host}:${port}\n`);
  });
}
