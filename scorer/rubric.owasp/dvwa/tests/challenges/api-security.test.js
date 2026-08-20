/**
 * API Security — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level and replays the level's API exploit.
 * The test PASSES only when the exploit-success signal is ABSENT — so a
 * contestant who merely breaks the API (e.g. returns 500 for everything)
 * does not score "patched". The normal-response assertion (200 for safe
 * requests) catches "break everything" non-fixes.
 *
 * LOW: Excessive data exposure — the deprecated v1 schema leaks password
 *      hashes. Patched = v1 no longer exposes the `password` field.
 * MEDIUM: Mass assignment / BOLA — PUT /v2/user/2 with {"level":0}
 *         elevates the user to admin. Patched = `level` field ignored in PUT.
 * HIGH: OS command injection in POST /v2/health/connectivity.
 *       Patched = injected shell operators don't flip the result to "OK".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel , assertDvwaApiRecord } from '../helpers.js';

const BASE = process.env.DVWA_URL ?? 'http://localhost:4280';
const API = '/vulnerabilities/api';

function apiFetch(cookieHeader, level, path, { method = 'GET', body } = {}) {
  return fetch(`${BASE}${API}${path}`, {
    method,
    headers: {
      Cookie: `${cookieHeader}; security=${level}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'follow',
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
}

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-16-API-Security-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  // Safe request (v2) must still work — catches "break the API" non-fixes.
  const v2 = await apiFetch(cookies.cookieHeader, 'low', '/v2/user/');
  assertDvwaApiRecord(v2, 'v2 user list must return 200 after patching');
  assert.ok(!v2.text.includes('password'), 'v2 must not expose password hashes');

  // Exploit: v1 leaks password hashes. Patched = v1 no longer exposes `password`.
  const v1 = await apiFetch(cookies.cookieHeader, 'low', '/v1/user/');
  assert.ok(
    !v1.text.includes('password'),
    'API low must be patched: v1 must not expose password hashes (excessive data exposure)'
  );
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-16-API-Security-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  // Safe request: GET a user record to confirm the API still works.
  const get = await apiFetch(cookies.cookieHeader, 'medium', '/v2/user/2');
  assertDvwaApiRecord(get, 'GET /v2/user/2 must return 200 after patching');

  // Exploit: mass assignment — send `level:0` to elevate user to admin.
  // Patched = `level` is ignored; the response should not reflect level:0.
  const put = await apiFetch(cookies.cookieHeader, 'medium', '/v2/user/2', {
    method: 'PUT',
    body: { name: 'morph', level: 0 },
  });
  assert.ok(
    !/"level"\s*:\s*0/.test(put.text),
    `API medium must be patched: PUT with level:0 must not escalate privileges; got: ${put.text}`
  );
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-16-API-Security-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  // Baseline: a genuinely unreachable host should report failure (sanity check).
  const failed = await apiFetch(cookies.cookieHeader, 'high', '/v2/health/connectivity', {
    method: 'POST',
    body: { target: 'nonexistent.invalid.zzz' },
  });
  assert.match(
    failed.text,
    /Connection failed/,
    'a non-resolvable host must still report Connection failed (API health check must be functional)'
  );

  // Exploit: OS command injection appends `|| echo pwned` to force exit-code 0.
  // Patched = the injected command does not flip the result to "OK".
  const injected = await apiFetch(cookies.cookieHeader, 'high', '/v2/health/connectivity', {
    method: 'POST',
    body: { target: 'nonexistent.invalid.zzz || echo pwned' },
  });
  assert.ok(
    !/"status"\s*:\s*"OK"/.test(injected.text),
    `API high must be patched: OS command injection must not flip status to OK; got: ${injected.text}`
  );
});
