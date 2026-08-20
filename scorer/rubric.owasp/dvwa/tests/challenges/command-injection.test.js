/**
 * Command Injection — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level, replays the known working exploit for that
 * level, and asserts the signal is ABSENT from a normal 200 response. A contestant
 * who merely breaks the page (non-200) does not score "patched".
 *
 * LOW:    No filtering — semicolon chaining (`; id`) leaks `uid=`.
 * MEDIUM: Strips `;` and `&&` but NOT `|` — pipe injection (`| id`) leaks `uid=`.
 * HIGH:   Strips more chars but bare `|` (no surrounding space) still passes through
 *         str_replace — same pipe payload leaks `uid=`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch , assertDvwaRendered } from '../helpers.js';

const EXEC_URL = '/vulnerabilities/exec/';
const EXECUTED = (t) => /uid=/.test(t); // `id` output signal

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-2-Command-Injection-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  // No filtering at all — semicolon command chaining.
  const { status, text } = await dvwaFetch(EXEC_URL, {
    cookies,
    method: 'POST',
    body: 'ip=127.0.0.1;id&Submit=Submit',
  });

  assertDvwaRendered({ status, text }, 'patched exec endpoint should still serve a normal 200');
  assert.ok(!EXECUTED(text), 'exec-low must be blocked: semicolon chaining must not leak uid=');
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-2-Command-Injection-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  // Medium strips ';' and '&&' but NOT '|'. Pipe bypass works.
  const { status, text } = await dvwaFetch(EXEC_URL, {
    cookies,
    method: 'POST',
    body: 'ip=127.0.0.1|id&Submit=Submit',
  });

  assertDvwaRendered({ status, text }, 'patched exec endpoint should still serve a normal 200');
  assert.ok(!EXECUTED(text), 'exec-medium must be blocked: pipe injection must not leak uid=');
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-2-Command-Injection-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  // High adds more filters but bare '|' (no surrounding space) is NOT in the
  // str_replace blacklist — same pipe payload still injects.
  const { status, text } = await dvwaFetch(EXEC_URL, {
    cookies,
    method: 'POST',
    body: 'ip=127.0.0.1|id&Submit=Submit',
  });

  assertDvwaRendered({ status, text }, 'patched exec endpoint should still serve a normal 200');
  assert.ok(!EXECUTED(text), 'exec-high must be blocked: bare-pipe injection must not leak uid=');
});
