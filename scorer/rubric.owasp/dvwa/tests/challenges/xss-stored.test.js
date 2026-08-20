/**
 * Stored XSS — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level, POSTs a uniquely-tagged XSS payload to
 * the guestbook, then GETs the page to check persistence.  The test passes
 * only when the app still serves a normal 200 AND the raw (unescaped) payload
 * does NOT appear in the stored output.
 *
 * Signal: absence of the LITERAL unescaped payload in the GET response.
 *   low    — <script>alert(tag)</script> in message must not appear verbatim
 *   medium — onerror=alert(tag) in the name field must not appear verbatim
 *   high   — onerror=alert(tag) in the name field must not appear verbatim
 *
 * A patched app that HTML-encodes the payload (&lt;script&gt;) or strips it
 * entirely will correctly pass; raw unescaped output fails.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch , assertDvwaRendered } from '../helpers.js';

const XSS_S = '/vulnerabilities/xss_s/';

async function sign(cookies, { name, message }) {
  return dvwaFetch(XSS_S, {
    cookies,
    method: 'POST',
    body: new URLSearchParams({ txtName: name, mtxMessage: message, btnSign: 'Sign Guestbook' }),
  });
}

await test('Challenge-12-XSS-Stored-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  const tag = `sl_${Date.now()}`;
  const payload = `<script>alert("${tag}")</script>`;
  await sign(cookies, { name: 'tester', message: payload });

  const { status, text } = await dvwaFetch(XSS_S, { cookies });
  assertDvwaRendered({ status, text }, 'patched guestbook must still return 200');
  assert.ok(!text.includes(payload), 'xss_s-low: raw <script> payload must not persist unescaped in the guestbook');
});

await test('Challenge-12-XSS-Stored-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  // The message field is fully sanitised; the name field only strips literal <script>.
  // An <img onerror> handler in the name field bypasses the blacklist.
  const tag = `sm_${Date.now()}`;
  // Use the exact signal the exploit test checks: onerror=alert("tag")
  const namePayload = `<img src=x onerror=alert("${tag}")>`;
  await sign(cookies, { name: namePayload, message: 'hello' });

  const { status, text } = await dvwaFetch(XSS_S, { cookies });
  assertDvwaRendered({ status, text }, 'patched guestbook must still return 200');
  assert.ok(
    !text.includes(`onerror=alert("${tag}")`),
    'xss_s-medium: <img onerror> name payload must not persist unescaped in the guestbook'
  );
});

await test('Challenge-12-XSS-Stored-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  // The name regex kills <script> variants but event-handler attributes are not matched.
  const tag = `sh_${Date.now()}`;
  const namePayload = `<img src=x onerror=alert("${tag}")>`;
  await sign(cookies, { name: namePayload, message: 'hi' });

  const { status, text } = await dvwaFetch(XSS_S, { cookies });
  assertDvwaRendered({ status, text }, 'patched guestbook must still return 200');
  assert.ok(
    !text.includes(`onerror=alert("${tag}")`),
    'xss_s-high: <img onerror> name payload must not persist unescaped in the guestbook'
  );
});
