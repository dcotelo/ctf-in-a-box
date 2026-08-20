/**
 * Cryptography — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level and replays the level's crypto exploit.
 * The test PASSES only when the forged/decoded credential is REJECTED — so a
 * contestant who merely breaks the login form does not score "patched". A
 * normal-response assertion on a legitimate path guards against that.
 *
 * LOW: A reversible XOR cipher with a hardcoded key ("wachtwoord"); the
 *      intercepted ciphertext decodes to "Olifant". Patched = that password
 *      is no longer accepted (key rotated or cipher replaced).
 * MEDIUM: AES-128-ECB session tokens with a hardcoded key. An attacker can
 *         forge a token for {user:"sweep",level:"admin"}. Patched = the forged
 *         token is rejected (key rotated or ECB replaced).
 * HIGH: AES-128-CBC tokens with a hardcoded key + IV (both leaked in source).
 *       Forge a token for userid:1 (admin "Geoffery"). Patched = the forged
 *       token is rejected by the check_token_high.php endpoint.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch , assertDvwaAlive } from '../helpers.js';

const BASE = process.env.DVWA_URL ?? 'http://localhost:4280';
const CRYPTO = '/vulnerabilities/cryptography/';

// XOR helper matching the DVWA low implementation.
function xor(buf, key) {
  let out = '';
  for (let i = 0; i < buf.length; i++) out += String.fromCharCode(buf[i] ^ key.charCodeAt(i % key.length));
  return out;
}

// AES-128 uses the first 16 bytes of the (over-length) key, like PHP's openssl_*.
function aes128Key(str) {
  const k = Buffer.alloc(16);
  Buffer.from(str).copy(k);
  return k;
}

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-19-Cryptography-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');
  // Anti-vacuous: this challenge's verdict is not a page, so prove the app is
  // actually serving its own challenge page before trusting the outcome
  // (docs/scorer.md, #105).
  await assertDvwaAlive(cookies, CRYPTO, 'cryptography low');

  // Exploit: XOR-decode the intercepted ciphertext to recover the hardcoded password.
  const intercepted = 'Lg4WGlQZChhSFBYSEB8bBQtPGxdNQSwEHREOAQY=';
  const plaintext = xor(Buffer.from(intercepted, 'base64'), 'wachtwoord');
  // The decoded value should contain "Olifant" — assert it so test is self-documenting.
  assert.match(plaintext, /Olifant/, 'XOR decode must still yield the expected plaintext (test sanity)');

  // Confirm the CSRF form is present so we know the page is up.
  const { text: page } = await dvwaFetch(CRYPTO, { cookies });
  assert.ok(page.includes('form'), 'cryptography low page must return a form (200 health check)');

  // Exploit: submit the decoded password — must be rejected when patched.
  const { status, text } = await dvwaFetch(CRYPTO, {
    cookies,
    method: 'POST',
    body: new URLSearchParams({ password: 'Olifant' }),
  });
  assert.equal(status, 200, 'patched cryptography endpoint should still serve a normal 200');
  assert.ok(
    !text.includes('Welcome back user'),
    'Cryptography low must be patched: XOR-recovered password must not be accepted'
  );
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-19-Cryptography-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');
  // Anti-vacuous: this challenge's verdict is not a page, so prove the app is
  // actually serving its own challenge page before trusting the outcome
  // (docs/scorer.md, #105).
  await assertDvwaAlive(cookies, CRYPTO, 'cryptography medium');

  // Exploit: forge an AES-128-ECB admin token using the hardcoded key.
  const key = aes128Key('ik ben een aardbei');
  const future = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
  const cipher = createCipheriv('aes-128-ecb', key, null);
  const token = Buffer.concat([
    cipher.update(JSON.stringify({ user: 'sweep', ex: future, level: 'admin' }), 'utf8'),
    cipher.final(),
  ]).toString('hex');

  // Confirm the page is up.
  const { text: page } = await dvwaFetch(CRYPTO, { cookies });
  assert.ok(page.includes('form'), 'cryptography medium page must return a form (200 health check)');

  // Submit the forged token — must be rejected when patched.
  const { status, text } = await dvwaFetch(CRYPTO, {
    cookies,
    method: 'POST',
    body: new URLSearchParams({ token }),
  });
  assert.equal(status, 200, 'patched cryptography endpoint should still serve a normal 200');
  assert.ok(
    !text.includes('Welcome administrator Sweep'),
    'Cryptography medium must be patched: forged AES-ECB admin token must not be accepted'
  );
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-19-Cryptography-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');
  // Anti-vacuous: this challenge's verdict is not a page, so prove the app is
  // actually serving its own challenge page before trusting the outcome
  // (docs/scorer.md, #105).
  await assertDvwaAlive(cookies, CRYPTO, 'cryptography high');

  // Exploit: forge an AES-128-CBC token for userid:1 (admin) using the leaked key + IV.
  const key = aes128Key('rainbowclimbinghigh');
  const iv = Buffer.from('1234567812345678');
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const ct = Buffer.concat([cipher.update('userid:1', 'utf8'), cipher.final()]);
  const payload = JSON.stringify({ token: ct.toString('base64'), iv: iv.toString('base64') });

  // Submit to the check endpoint — must be rejected when patched.
  const res = await fetch(`${BASE}${CRYPTO}source/check_token_high.php`, {
    method: 'POST',
    headers: { Cookie: `${cookies.cookieHeader}; security=high`, 'Content-Type': 'application/json' },
    body: payload,
  });
  assert.equal(res.status, 200, 'patched check_token_high.php should still return 200');
  const text = await res.text();
  assert.ok(
    !/"level"\s*:\s*"admin"/.test(text),
    `Cryptography high must be patched: forged AES-CBC token must not grant admin level; got: ${text}`
  );
});
