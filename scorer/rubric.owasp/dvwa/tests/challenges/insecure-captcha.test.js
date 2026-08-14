/**
 * Insecure CAPTCHA — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level and replays the level's CAPTCHA-bypass exploit.
 * The test passes only when the bypass is rejected: the password is NOT changed, so
 * a fresh login with the original credential still succeeds.
 *
 *   - LOW  (stock): jump straight to step=2, skipping the CAPTCHA-gated step 1.
 *   - MEDIUM (stock): the `passed_captcha=true` hidden field is the only gate — forge it.
 *   - HIGH  (stock): a hardcoded back-door — g-recaptcha-response=hidd3n_valu3 combined
 *                    with the User-Agent header "reCAPTCHA" bypasses the server-side check.
 *
 * Signal strategy: attempt to change admin's password to a canary value; then try to log
 * in with that canary. If the bypass is blocked the canary login fails (Location: login.php).
 * If the bypass succeeds the canary login succeeds — that is the OPEN/exploit-fires signal.
 *
 * "Patched" = bypass attempt is rejected AND admin's original credential still works.
 *
 * NOTE: This DVWA build has no reCAPTCHA API key, so index.php overwrites the "Password
 * Changed." message with a "register for a key" warning. We therefore cannot check the
 * response body for success text — we confirm via fresh loginDvwa() instead.
 *
 * Subtest names equal the catalogue keys (captcha-low/medium/high).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch } from '../helpers.js';

const CAPTCHA_URL = '/vulnerabilities/captcha/';

/** Canary password used in bypass attempts — must differ from the real password. */
const CANARY = 'BYPASS_WAS_HERE_99';
/** Admin's real password (the one the CTF instance ships with). */
const REAL_PASSWORD = 'password';

/**
 * Try to log in as admin with the given password. Returns true if login succeeds
 * (Location: index.php), false if it fails (Location: login.php or no redirect).
 *
 * Avoids loginDvwa() so we don't throw on auth failure — this is used as a probe.
 */
const BASE = process.env.DVWA_URL ?? 'http://localhost:4280';

async function tryLogin(password) {
  // GET the login page to obtain PHPSESSID + user_token.
  const getRes = await fetch(`${BASE}/login.php`, { redirect: 'manual' });
  const html   = await getRes.text();
  const tokenM = html.match(/name=['"]user_token['"][^>]*value=['"]([^'"]+)['"]/);
  const token  = tokenM ? tokenM[1] : '';
  const rawCookies = typeof getRes.headers.getSetCookie === 'function'
    ? getRes.headers.getSetCookie()
    : (getRes.headers.get('set-cookie') ? [getRes.headers.get('set-cookie')] : []);
  const cookiePairs = rawCookies.map((h) => h.split(';')[0].trim()).join('; ');

  // POST credentials.
  const postRes = await fetch(`${BASE}/login.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookiePairs },
    body: new URLSearchParams({ username: 'admin', password, Login: 'Login', user_token: token }).toString(),
    redirect: 'manual',
  });
  const location = postRes.headers.get('location') ?? '';
  return location.includes('index.php');
}

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-6-Insecure-CAPTCHA-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  // Stock exploit: jump straight to step=2, bypassing the CAPTCHA-gated step 1 entirely.
  await dvwaFetch(CAPTCHA_URL, {
    cookies,
    method: 'POST',
    body: new URLSearchParams({ step: '2', password_new: CANARY, password_conf: CANARY, Change: 'Change' }),
  });

  // If the bypass was blocked, the canary login should fail and real password should still work.
  const canaryWorks = await tryLogin(CANARY);

  // Clean up: attempt to restore the password regardless of canary result,
  // so we don't poison subsequent tests (uses whatever session is valid now).
  if (canaryWorks) {
    // Need to login with canary to restore
    const restoreCookies = await loginDvwa({ password: CANARY });
    await setSecurityLevel(restoreCookies, 'low');
    await dvwaFetch(CAPTCHA_URL, {
      cookies: restoreCookies,
      method: 'POST',
      body: new URLSearchParams({ step: '2', password_new: REAL_PASSWORD, password_conf: REAL_PASSWORD, Change: 'Change' }),
    });
  }

  assert.ok(
    !canaryWorks,
    'CAPTCHA low must be patched: the step-2 bypass must not change the admin password without a valid CAPTCHA'
  );
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-6-Insecure-CAPTCHA-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  // Stock exploit: submit step=2 with the client-controlled passed_captcha=true flag.
  await dvwaFetch(CAPTCHA_URL, {
    cookies,
    method: 'POST',
    body: new URLSearchParams({
      step: '2',
      password_new: CANARY,
      password_conf: CANARY,
      Change: 'Change',
      passed_captcha: 'true',
    }),
  });

  const canaryWorks = await tryLogin(CANARY);

  if (canaryWorks) {
    const restoreCookies = await loginDvwa({ password: CANARY });
    await setSecurityLevel(restoreCookies, 'medium');
    await dvwaFetch(CAPTCHA_URL, {
      cookies: restoreCookies,
      method: 'POST',
      body: new URLSearchParams({
        step: '2', password_new: REAL_PASSWORD, password_conf: REAL_PASSWORD,
        Change: 'Change', passed_captcha: 'true',
      }),
    });
  }

  assert.ok(
    !canaryWorks,
    'CAPTCHA medium must be patched: forging passed_captcha=true must not change the admin password'
  );
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-6-Insecure-CAPTCHA-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  // Stock exploit: hardcoded back-door — hidd3n_valu3 + User-Agent: reCAPTCHA.
  await dvwaFetch(CAPTCHA_URL, {
    cookies,
    method: 'POST',
    headers: { 'User-Agent': 'reCAPTCHA' },
    body: new URLSearchParams({
      password_new: CANARY,
      password_conf: CANARY,
      Change: 'Change',
      'g-recaptcha-response': 'hidd3n_valu3',
    }),
  });

  const canaryWorks = await tryLogin(CANARY);

  if (canaryWorks) {
    const restoreCookies = await loginDvwa({ password: CANARY });
    await setSecurityLevel(restoreCookies, 'high');
    await dvwaFetch(CAPTCHA_URL, {
      cookies: restoreCookies,
      method: 'POST',
      headers: { 'User-Agent': 'reCAPTCHA' },
      body: new URLSearchParams({
        password_new: REAL_PASSWORD, password_conf: REAL_PASSWORD,
        Change: 'Change', 'g-recaptcha-response': 'hidd3n_valu3',
      }),
    });
  }

  assert.ok(
    !canaryWorks,
    'CAPTCHA high must be patched: the hidd3n_valu3 / reCAPTCHA User-Agent back-door must be removed'
  );
});
