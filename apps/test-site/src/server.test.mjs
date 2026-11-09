import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTestSiteServer } from "./server.mjs";

let server;
let baseUrl;

before(async () => {
  server = createTestSiteServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const credentials = new URLSearchParams({
  email: "agentlogin-test@example.com",
  password: "agentlogin-synthetic-password",
  scenario: "success"
});

test("health endpoint identifies the synthetic test site", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "agentlogin-synthetic-site" });
});

test("valid synthetic credentials create an authenticated session", async () => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST", body: credentials, headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual"
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  const session = await fetch(`${baseUrl}/session`, { headers: { cookie } });
  assert.deepEqual(await session.json(), { authenticated: true, mfa_required: false });
});

test("invalid credentials are rejected without creating a session", async () => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    body: new URLSearchParams({ email: "agentlogin-test@example.com", password: "wrong", scenario: "success" }),
    headers: { "content-type": "application/x-www-form-urlencoded" }
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("MFA scenario requires the synthetic one-time code before authentication", async () => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    body: new URLSearchParams({ ...Object.fromEntries(credentials), scenario: "mfa" }),
    headers: { "content-type": "application/x-www-form-urlencoded" }
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.deepEqual(await (await fetch(`${baseUrl}/session`, { headers: { cookie } })).json(), {
    authenticated: false, mfa_required: true
  });

  const rejected = await fetch(`${baseUrl}/mfa`, {
    method: "POST", body: new URLSearchParams({ code: "000000" }),
    headers: { "content-type": "application/x-www-form-urlencoded", cookie }
  });
  assert.equal(rejected.status, 401);

  const accepted = await fetch(`${baseUrl}/mfa`, {
    method: "POST", body: new URLSearchParams({ code: "246810" }),
    headers: { "content-type": "application/x-www-form-urlencoded", cookie }
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await (await fetch(`${baseUrl}/session`, { headers: { cookie } })).json(), {
    authenticated: true, mfa_required: false
  });
});

test("logout invalidates the session", async () => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST", body: credentials, headers: { "content-type": "application/x-www-form-urlencoded" }
  });
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const logout = await fetch(`${baseUrl}/logout`, {
    method: "POST", headers: { cookie }
  });
  assert.deepEqual(await logout.json(), { logged_out: true });
  assert.deepEqual(await (await fetch(`${baseUrl}/session`, { headers: { cookie } })).json(), {
    authenticated: false, mfa_required: false
  });
});
