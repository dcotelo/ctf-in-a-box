/**
 * Content Security Policy Bypass — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level and replays the level's CSP bypass.
 * The test passes only when the app still serves a normal 200 AND the bypass
 * signal is ABSENT.
 *
 * LOW: Vulnerable CSP allow-lists third-party hosts (pastebin.com etc.).  Signal:
 *   the `content-security-policy` header must NOT contain `pastebin.com`, AND the
 *   reflected `<script src='…pastebin…'>` tag must NOT appear in the body.
 *
 * MEDIUM: A static nonce is reused on every request.  Signal: the CSP header
 *   must NOT contain `unsafe-inline` (patching removes either inline or the
 *   static nonce that makes it exploitable).
 *
 * HIGH: A same-origin JSONP endpoint reflects the `callback` parameter.
 *   NEEDS_REVIEW — the `jsonp.php` endpoint is never level-gated; it returns
 *   `callback({…})` at both `high` and `impossible`.  There is no server-side
 *   signal that distinguishes a patched high from a vulnerable high without
 *   changing the endpoint itself.  This subtest is marked as a TODO and skipped
 *   to avoid emitting a hollow assertion.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch } from '../helpers.js';

const CSP = '/vulnerabilities/csp/';
const STATIC_NONCE = 'TmV2ZXIgZ29pbmcgdG8gZ2l2ZSB5b3UgdXA=';

/**
 * Positive control marker: the CSP challenge page renders the `include` input form. Asserting
 * only the ABSENCE of a bypass signal would silently score "patched" whenever the request never
 * reached the real, functional CSP page (a broken endpoint, a login bounce, a renamed param that
 * the server ignored). Requiring the challenge form proves the page processed the payload, so an
 * absent allow-list / inline-policy signal can only mean a genuine patch.
 */
const CSP_PAGE = /name=['"]include['"]/;

await test('Challenge-13-CSP-Bypass-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  const { status, text, headers } = await dvwaFetch(CSP, {
    cookies,
    method: 'POST',
    body: new URLSearchParams({ include: 'https://pastebin.com/raw/evil' }),
  });

  const cspHeader = headers.get('content-security-policy') || '';
  assert.equal(status, 200, 'patched CSP low endpoint must still return 200');
  assert.match(text, CSP_PAGE, 'csp-low positive control: the CSP challenge page (include form) must be present');
  assert.ok(
    !cspHeader.includes('pastebin.com'),
    'csp-low: patched CSP header must not allow-list pastebin.com'
  );
  assert.ok(
    !text.includes("<script src='https://pastebin.com/raw/evil'>"),
    'csp-low: patched page must not reflect the attacker <script src> tag'
  );
});

await test('Challenge-13-CSP-Bypass-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  const inline = `<script nonce=${STATIC_NONCE}>alert(1)</script>`;
  const { status, text, headers } = await dvwaFetch(CSP, {
    cookies,
    method: 'POST',
    body: new URLSearchParams({ include: inline }),
  });

  const cspHeader = headers.get('content-security-policy') || '';
  assert.equal(status, 200, 'patched CSP medium endpoint must still return 200');
  assert.match(text, CSP_PAGE, 'csp-medium positive control: the CSP challenge page (include form) must be present');
  // The static nonce + unsafe-inline together make the bypass possible.
  // A correct patch removes 'unsafe-inline' (and/or rotates the nonce per request).
  assert.ok(
    !cspHeader.includes("'unsafe-inline'"),
    "csp-medium: patched CSP must not allow 'unsafe-inline' (static-nonce bypass)"
  );
});

