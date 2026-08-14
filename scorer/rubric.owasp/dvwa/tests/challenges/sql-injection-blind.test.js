/**
 * SQL Injection (Blind) — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level and replays a boolean-differential exploit
 * for that level. The test passes only when the app still serves a normal 200 AND
 * the TRUE-condition payload does NOT produce the "User ID exists" oracle response —
 * i.e. the boolean differential can no longer be exploited.
 *
 * LOW:    Boolean-based blind via GET `id` — `1' AND 1=1-- ` returns "exists";
 *         `1' AND 1=2-- ` returns "MISSING".
 * MEDIUM: POST-based, unquoted numeric field — bare `1 AND 1=1` / `1 AND 1=2`
 *         (no quotes needed) drives the same differential.
 * HIGH:   Cookie-based — `$_COOKIE['id']` used in a string query; inject via the
 *         `id` cookie entry in the jar.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch } from '../helpers.js';

const SQLI_BLIND_URL = '/vulnerabilities/sqli_blind/';
// Oracle signal: a TRUE condition produces this string; a patched app must not.
const ORACLE = (t) => /User ID exists in the database/i.test(t);

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-8-SQL-Injection-Blind-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  // Boolean-based blind via GET parameter; `--+` is `-- ` URL-encoded.
  const { status, text } = await dvwaFetch(
    `${SQLI_BLIND_URL}?id=1'+AND+1=1--+&Submit=Submit`,
    { cookies }
  );

  assert.equal(status, 200, 'patched sqli_blind endpoint should still serve a normal 200');
  assert.ok(!ORACLE(text), 'sqli_blind-low must be blocked: TRUE boolean payload must not produce the oracle response');
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-8-SQL-Injection-Blind-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  // POST-based, unquoted numeric field — no quote needed for injection.
  const { status, text } = await dvwaFetch(SQLI_BLIND_URL, {
    cookies,
    method: 'POST',
    body: new URLSearchParams({ id: '1 AND 1=1', Submit: 'Submit' }),
  });

  assert.equal(status, 200, 'patched sqli_blind endpoint should still serve a normal 200');
  assert.ok(!ORACLE(text), 'sqli_blind-medium must be blocked: unquoted numeric TRUE condition must not leak oracle response');
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-8-SQL-Injection-Blind-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  // Cookie-based injection: set the `id` cookie to a TRUE boolean payload.
  cookies.jar.set('id', encodeURIComponent("1' AND 1=1#"));
  const { status, text } = await dvwaFetch(SQLI_BLIND_URL, { cookies });
  // Clean up the injected cookie so it does not affect other tests.
  cookies.jar.erase('id');

  assert.equal(status, 200, 'patched sqli_blind endpoint should still serve a normal 200');
  assert.ok(!ORACLE(text), 'sqli_blind-high must be blocked: cookie-based TRUE condition must not produce oracle response');
});
