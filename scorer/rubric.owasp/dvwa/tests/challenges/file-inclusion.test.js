/**
 * File Inclusion — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level, replays the known bypass for that level, and
 * asserts that /etc/passwd content does NOT appear in a normal 200 response.
 *
 * LOW:    Direct `$_GET['page']` include, no validation — classic path traversal.
 * MEDIUM: Strips `../` and `..\` once — double-dot collapse (`....//`) bypasses.
 * HIGH:   Allowlist requires `fnmatch("file*", ...)` — `file://` URI satisfies it
 *         while still reading an absolute path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch } from '../helpers.js';

const FI_URL = '/vulnerabilities/fi/';
const LEAKED = (t) => /root:/.test(t); // /etc/passwd signal

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-4-File-Inclusion-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  const { status, text } = await dvwaFetch(
    `${FI_URL}?page=../../../../../../etc/passwd`,
    { cookies }
  );

  assert.equal(status, 200, 'patched fi endpoint should still serve a normal 200');
  assert.ok(!LEAKED(text), 'fi-low must be blocked: path traversal must not expose /etc/passwd');
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-4-File-Inclusion-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  // Double-dot collapse bypasses the one-pass strip of `../`.
  const { status, text } = await dvwaFetch(
    `${FI_URL}?page=....//....//....//....//....//etc/passwd`,
    { cookies }
  );

  assert.equal(status, 200, 'patched fi endpoint should still serve a normal 200');
  assert.ok(!LEAKED(text), 'fi-medium must be blocked: double-dot bypass must not expose /etc/passwd');
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-4-File-Inclusion-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  // file:// URI satisfies the fnmatch("file*", ...) allowlist and reads an absolute path.
  const { status, text } = await dvwaFetch(
    `${FI_URL}?page=file:///etc/passwd`,
    { cookies }
  );

  assert.equal(status, 200, 'patched fi endpoint should still serve a normal 200');
  assert.ok(!LEAKED(text), 'fi-high must be blocked: file:// wrapper must not expose /etc/passwd');
});
