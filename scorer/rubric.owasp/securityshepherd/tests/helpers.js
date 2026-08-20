// Test helpers for OWASP Security Shepherd CTF regression tests.
//
// Security Shepherd ships a self-signed TLS certificate that EXPIRED in 2019
// (notAfter=Jan 11 16:01:08 2019 GMT). Pinning the extracted CA via `ca:` therefore
// cannot succeed — Node still rejects the chain on date grounds. Because this is a
// local, intentionally-vulnerable training target (no production data, no MITM risk
// on localhost), we disable chain verification for the test HTTPS agent. The cert is
// still loaded when present so that, if the instance is ever re-issued with a valid
// cert, flipping `rejectUnauthorized` back to true is the only change required.

import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.SECURITYSHEPHERD_URL ?? 'https://localhost:8443';
const CA_CERT_PATH = process.env.SECURITYSHEPHERD_CA ?? '/tmp/ss_ca.pem';

// Node's global fetch (undici) ignores the legacy `http.Agent` option and validates TLS itself.
// The Security Shepherd cert is a long-expired (2019) self-signed LOCAL cert, so chain
// verification can never succeed regardless of pinning. As this is a local, intentionally
// vulnerable training target (no production data, no MITM risk on localhost), disable TLS chain
// verification for the test process. We avoid a hard `undici` import (not resolvable without
// node_modules) by toggling the documented Node flag; the extracted CA path is still honoured for
// documentation/auditing. To re-enable verification against a re-issued valid cert, remove this
// line and pass the CA via an undici dispatcher.
if (CA_CERT_PATH && !existsSync(CA_CERT_PATH)) { /* CA not extracted; verification stays disabled */ }
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '0';
const agent = undefined; // retained for call-site compatibility; undici fetch ignores it.

export { BASE, agent };

export async function waitForShepherd({ timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/login.jsp`, { agent });
      if (res.ok) return;
    } catch {}
    await sleep(2000);
  }
  throw new Error(`Security Shepherd not reachable at ${BASE} after ${timeoutMs}ms`);
}

// Log in as admin. Security Shepherd's /login servlet reads params `login` and `pwd`,
// returns 302 -> index.jsp on success, and sets JSESSIONID + a CSRF `token` cookie.
export async function loginShepherd(
  userName = process.env.SECURITYSHEPHERD_USER ?? 'admin',
  password = process.env.SECURITYSHEPHERD_PASS ?? 'SecurityShepherd',
) {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `login=${encodeURIComponent(userName)}&pwd=${encodeURIComponent(password)}`,
    redirect: 'manual',
    agent,
  });
  const setCookieHeaders = res.headers.getSetCookie?.() ?? [];
  const cookies = {};
  for (const header of setCookieHeaders) {
    const [pair] = header.split(';');
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) cookies[name] = value;
  }
  if (!cookies.JSESSIONID) throw new Error('Login failed — no JSESSIONID in Set-Cookie');
  if (!cookies.token) throw new Error('Login failed — no CSRF token in Set-Cookie');
  return cookies;
}

export function cookieString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

export async function ssGet(path, cookies, params = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (cookies.token) url.searchParams.set('csrfToken', cookies.token);
  const res = await fetch(url.toString(), {
    headers: { Cookie: cookieString(cookies) },
    agent,
  });
  return res.text();
}

// GET that also returns Set-Cookie headers (some challenges hand back tokens via cookies).
export async function ssGetRaw(path, cookies, params = {}, extraHeaders = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (cookies.token) url.searchParams.set('csrfToken', cookies.token);
  const res = await fetch(url.toString(), {
    headers: { Cookie: cookieString(cookies), ...extraHeaders },
    agent,
  });
  return { body: await res.text(), setCookie: res.headers.getSetCookie?.() ?? [], status: res.status };
}

export async function ssPost(path, cookies, params = {}, extraHeaders = {}) {
  const body = new URLSearchParams({ ...params, csrfToken: cookies.token ?? '' });
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookieString(cookies),
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
    },
    body: body.toString(),
    agent,
  });
  return res.text();
}

export async function ssPostRaw(path, cookies, params = {}, extraHeaders = {}) {
  const body = new URLSearchParams({ ...params, csrfToken: cookies.token ?? '' });
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookieString(cookies),
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
    },
    body: body.toString(),
    agent,
  });
  return { body: await res.text(), setCookie: res.headers.getSetCookie?.() ?? [], status: res.status };
}

export async function ssPostJson(path, cookies, data = {}, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookieString(cookies),
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({ ...data, csrfToken: cookies.token ?? '' }),
    agent,
  });
  return res.text();
}

export async function ssPostXml(path, cookies, xml, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookieString(cookies),
      'Content-Type': 'application/xml',
      ...extraHeaders,
    },
    body: xml,
    agent,
  });
  return res.text();
}

// Security Shepherd returns a per-user "result key" on success. These matchers decide
// whether a response proves the exploit worked, so an over-broad one does not merely
// mis-read a page — it fails a contestant who patched correctly (issue #42).
//
// Captured from the live app, on Challenge-10-IDOR-2:
//
//   solve    <h2 class='title'>Hidden User's Message</h2>
//            <p>Result Key is <a>1f746b87…64 hex…</a></p>
//   refusal  <h2 class='title'>User: 404 - User Not Found</h2>
//            <p>User 'c51ce410c124a10e0db5e4b97fc2af39' could not be found…</p>
//
// The refusal ECHOES the submitted id. That id is an MD5 — 32 hex — and the old
// contextless `[0-9a-f]{32,128}` fallback read the test's own payload back out of the
// error page and called it a result key. A correct patch therefore scored ❌ on 29 of
// the 40 challenges, all of which assert `!(hasSolvedMessage(body) || key)`.
//
// A real key is 64 hex and arrives with "Result Key is" in front of it, so the two
// CONTEXTUAL matchers already cover the real thing. The bare fallback survives only for
// a key that appears with no wording at all, and is raised to 64 so it can no longer
// collide with an echoed 32-hex user id. Anything shorter must carry context to count.
export function extractSolutionKey(html) {
  const json = html.match(/"resultKey"\s*:\s*"([^"]+)"/i);
  if (json) return json[1];
  const result = html.match(/result key is\s*<[^>]*>\s*([0-9a-f]{16,})/i);
  if (result) return result[1];
  const hex = html.match(/\b[0-9a-f]{64,128}\b/i);
  return hex ? hex[0] : null;
}

// The `correct` alternative was unbounded, so it matched the "correct" inside
// "incorrect" — any challenge whose refusal says "Incorrect …" read as a solve. It now
// requires a word boundary (none exists between "in" and "correct", so "incorrect" is
// excluded) and rejects a preceding negation, which covers the other way an app says
// no with the same word: "that was not correct".
//
// Residual limit, stated rather than papered over: only the "not " form of negation is
// handled. A refusal phrased "isn't correct" or "never correct" would still read as a
// solve. Chasing every negation with a regex is how this matcher got over-broad in the
// first place; if another phrasing turns up in a real response, add it here with the
// captured body, the way #42's fixtures were added.
export function hasSolvedMessage(html) {
  return /well\s*done|you\s*did\s*it|result\s*key|key\s*is|(?<!\bnot\s)\bcorrect\b|congratulations|congrats/i.test(html);
}

// ── Infrastructure / multi-user helpers ─────────────────────────────────────────
// Several Security Shepherd challenges are not pure single-request HTTP exploits:
//  - The NoSQL challenge needs ${catalina}/conf/mongo.properties (absent in the stock
//    container image — every NoSQL request 500s without it).
//  - The CSRF challenges need a SECOND authenticated user (the "attacker") whose forged
//    request increments the admin "victim's" counter (the target enforces attacker != victim).
//  - The bank IDOR transfer needs an attacker-owned account to receive stolen funds.
// Self-service registration is disabled in this instance, so we provision the second user
// directly in the bundled MariaDB container. These helpers shell out to `docker exec` against
// the well-known container names (secshep_mariadb / secshep_tomcat). They are best-effort:
// if docker is unavailable they no-op and the dependent test will surface the failure.

const MARIADB_CONTAINER = process.env.SECURITYSHEPHERD_DB_CONTAINER ?? 'secshep_mariadb';
const TOMCAT_CONTAINER = process.env.SECURITYSHEPHERD_TOMCAT_CONTAINER ?? 'secshep_tomcat';
const DB_ROOT_PASS = process.env.SECURITYSHEPHERD_DB_PASS ?? 'CowSaysMoo';
export const SECOND_USER = process.env.SECURITYSHEPHERD_ATTACKER ?? 'ctfattacker';
export const SECOND_PASS = process.env.SECURITYSHEPHERD_ATTACKER_PASS ?? 'SecurityShepherd';
const MONGO_HOST = process.env.SECURITYSHEPHERD_MONGO_HOST ?? 'secshep_mongo';

function dbExec(sql) {
  return execFileSync('docker', ['exec', MARIADB_CONTAINER, 'mariadb', '-uroot', `-p${DB_ROOT_PASS}`, '-N', '-e', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
}

// Create (idempotently) the attacker account, cloning admin's current Argon2 hash so its
// password equals SECOND_PASS. Returns the attacker's userId.
//
// docker-less sandbox: if the workflow already created the attacker host-side (where docker
// exists) it exports the resulting id as SS_USERID_CTFATTACKER; when present we trust it and
// skip the docker call entirely. Otherwise fall back to the direct DB create.
export function ensureSecondUser() {
  if (process.env.SS_USERID_CTFATTACKER) return process.env.SS_USERID_CTFATTACKER;
  const hash = dbExec(`SELECT userPass FROM core.users WHERE userName='admin';`).trim();
  dbExec(
    `DELETE FROM core.users WHERE userName='${SECOND_USER}';` +
    `CALL core.userCreate(null,'${SECOND_USER}','${hash}','player',null,'${SECOND_USER}@sec.org','login',false,false);`,
  );
  return dbExec(`SELECT userId FROM core.users WHERE userName='${SECOND_USER}';`).trim();
}

// docker-less sandbox: the workflow computes user ids host-side and exports them as
// SS_USERID_<UPPERCASE_USERNAME> (e.g. 'admin' -> SS_USERID_ADMIN, 'ctfattacker' ->
// SS_USERID_CTFATTACKER). When the matching env var is set and non-empty we use it and avoid
// shelling out to docker; otherwise fall back to the direct DB lookup.
export function getUserId(userName) {
  const envKey = `SS_USERID_${userName.toUpperCase()}`;
  if (process.env[envKey]) return process.env[envKey];
  return dbExec(`SELECT userId FROM core.users WHERE userName='${userName}';`).trim();
}

// The stock container ships without conf/mongo.properties; create it so NoSQL works.
// docker-less sandbox: if the workflow already wrote mongo.properties host-side it sets
// SS_MONGO_READY=1 (or 'true'); when present we return immediately and skip the docker call.
export function ensureMongoConfig() {
  const ready = process.env.SS_MONGO_READY;
  if (ready === '1' || ready === 'true') return;
  const props = [
    `connectionHost=${MONGO_HOST}`, 'connectionPort=27017', 'databaseName=shepherdGames',
    'databaseUsername=gamer1', 'databasePassword=$ecSh3pdb', 'databaseCollection=gamer',
    'connectTimeout=10000', 'socketTimeout=0', 'serverSelectionTimeout=30000',
    'pool.connectionsPerHost=10', 'pool.minConnectionsPerHost=2',
  ].join('\\n');
  try {
    execFileSync('docker', ['exec', TOMCAT_CONTAINER, 'sh', '-c',
      `printf '%b' "${props}\\n" > /usr/local/tomcat/conf/mongo.properties`], { stdio: 'ignore' });
  } catch { /* best effort */ }
}

// Read a CSRF challenge's per-user counter token value directly (used by CSRF7 enumeration test
// assertions where needed).
export function dbQuery(sql) { return dbExec(sql); }

// Log in as a named user, returning the cookie jar (JSESSIONID + token).
export async function loginAs(userName, password) {
  return loginShepherd(userName, password);
}

// Open a module for a user session so its `results` row exists (required before the CSRF
// counter can be incremented and the key revealed).
export async function openModule(cookies, moduleId) {
  await ssPost('/getModule', cookies, { moduleId });
}

// ── Classical-cipher decoders (Insecure Cryptographic Storage 1 & 2) ────────────
export function caesarDecode(text, shift) {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + shift) % 26 + 26) % 26 + base);
  });
}

export function vigenereDecode(text, key) {
  let ki = 0;
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    const k = key[ki % key.length].toLowerCase().charCodeAt(0) - 97;
    ki++;
    return String.fromCharCode(((c.charCodeAt(0) - base - k) % 26 + 26) % 26 + base);
  });
}

// Extract the longest lowercase-alpha ciphertext token from a rendered challenge JSP.
export function extractCipherText(html, minLen = 30) {
  const matches = html.match(/[A-Za-z]{30,}/g) ?? [];
  // ignore the level hash (hex) and CSS/script identifiers by preferring tokens with mixed case
  // that are not pure hex; the cipher blobs are the longest alpha runs in the body.
  const candidates = matches.filter((m) => m.length >= minLen && !/^[0-9a-f]+$/i.test(m));
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? null;
}
