/**
 * JavaScript (client-side token) — pass-when-PATCHED (patch CTF).
 *
 * The server trusts a token computed in the browser.  Because the algorithm
 * ships to the client, an attacker can reproduce it offline and submit a valid
 * token directly.  A patched server must not accept a pre-computed token —
 * i.e. submitting the known token must NOT yield "Well done!".
 *
 * Token algorithms (vulnerable state):
 *   low    — md5(rot13("success"))
 *   medium — strrev("XXsuccessXX")
 *   high   — sha256(sha256("XX" + strrev("success")) + "ZZ")
 *
 * Subtest names match the catalogue keys: javascript-low / javascript-medium / javascript-high.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch , assertDvwaRendered } from '../helpers.js';

const JS_URL = '/vulnerabilities/javascript/';

const md5 = (s) => createHash('md5').update(s).digest('hex');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const strrev = (s) => s.split('').reverse().join('');
const rot13 = (s) => s.replace(/[a-zA-Z]/g, (ch) => {
  const code = ch.charCodeAt(0) + 13;
  return String.fromCharCode((ch <= 'Z' ? 90 : 122) >= code ? code : code - 26);
});

async function submit(cookies, token) {
  const { status, text } = await dvwaFetch(JS_URL, {
    cookies,
    method: 'POST',
    body: new URLSearchParams({ token, phrase: 'success', send: 'Submit' }),
  });
  return { status, text };
}

await test('Challenge-14-JavaScript-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  const token = md5(rot13('success'));
  const { status, text } = await submit(cookies, token);
  assertDvwaRendered({ status, text }, 'patched JS low endpoint must still return 200');
  assert.ok(
    !text.includes('Well done!'),
    'javascript-low: pre-computed md5(rot13("success")) token must not be accepted by a patched server'
  );
});

await test('Challenge-14-JavaScript-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  const token = strrev('XXsuccessXX');
  const { status, text } = await submit(cookies, token);
  assertDvwaRendered({ status, text }, 'patched JS medium endpoint must still return 200');
  assert.ok(
    !text.includes('Well done!'),
    'javascript-medium: pre-computed strrev("XXsuccessXX") token must not be accepted by a patched server'
  );
});

await test('Challenge-14-JavaScript-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  const token = sha256(sha256('XX' + strrev('success')) + 'ZZ');
  const { status, text } = await submit(cookies, token);
  assertDvwaRendered({ status, text }, 'patched JS high endpoint must still return 200');
  assert.ok(
    !text.includes('Well done!'),
    'javascript-high: pre-computed sha256 token must not be accepted by a patched server'
  );
});
