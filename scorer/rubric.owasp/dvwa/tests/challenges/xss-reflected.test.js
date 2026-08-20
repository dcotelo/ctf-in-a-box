/**
 * Reflected XSS — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level and replays that level's XSS exploit.
 * The test passes only when the app still serves a normal 200 AND the raw
 * (unescaped) payload does NOT appear in the response — so a contestant who
 * merely breaks the page does not score "patched".
 *
 * Signal: absence of the LITERAL unescaped payload string (not html-encoded).
 *   low    — <script>alert(1)</script> must not appear verbatim
 *   medium — <ScRiPt>alert(1)</ScRiPt> (case-bypass) must not appear verbatim
 *   high   — <img src=x onerror=alert(1)> must not appear verbatim
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch , assertDvwaRendered } from '../helpers.js';

const XSS_R = '/vulnerabilities/xss_r/';

await test('Challenge-11-XSS-Reflected-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  const payload = '<script>alert(1)</script>';
  const { status, text } = await dvwaFetch(`${XSS_R}?name=${encodeURIComponent(payload)}`, { cookies });

  assertDvwaRendered({ status, text }, 'patched endpoint must still return 200');
  assert.ok(!text.includes(payload), 'xss_r-low: raw <script> payload must not appear unescaped');
});

await test('Challenge-11-XSS-Reflected-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  // Mixed-case bypasses the literal str_replace('<script>','') blacklist.
  const payload = '<ScRiPt>alert(1)</ScRiPt>';
  const { status, text } = await dvwaFetch(`${XSS_R}?name=${encodeURIComponent(payload)}`, { cookies });

  assertDvwaRendered({ status, text }, 'patched endpoint must still return 200');
  assert.ok(!text.includes(payload), 'xss_r-medium: mixed-case script payload must not appear unescaped');
});

await test('Challenge-11-XSS-Reflected-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  // The preg_replace strips <...script...> but an event-handler tag is not matched.
  const payload = '<img src=x onerror=alert(1)>';
  const { status, text } = await dvwaFetch(`${XSS_R}?name=${encodeURIComponent(payload)}`, { cookies });

  assertDvwaRendered({ status, text }, 'patched endpoint must still return 200');
  assert.ok(!text.includes(payload), 'xss_r-high: <img onerror> payload must not appear unescaped');
});
