/**
 * Cross-Site Request Forgery — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level and replays the level's CSRF exploit.
 * The test PASSES only when the server is still healthy (200) AND the forged
 * request is REJECTED (no "Password Changed" in the response) — so a
 * contestant who merely breaks the page does not score "patched".
 *
 * LOW: No CSRF protection — a bare GET request with no token must be blocked.
 * MEDIUM: Referer check, easily spoofed — spoofed-Referer request must be blocked.
 * HIGH: Per-session anti-CSRF token, but tokens are not single-use — a harvested
 *       token replayed in a same-session request must be blocked.
 *
 * Each test resets the database first (restores admin/password) AND again in a
 * finally block afterwards, so the CSRF exploit (which changes the password on an
 * unpatched app) can't break subsequent challenges that log in as admin/password —
 * even when the assertion fails and the test body throws.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch } from '../helpers.js';

const BASE = process.env.DVWA_URL ?? 'http://localhost:4280';
const CSRF_URL = '/vulnerabilities/csrf/';

/**
 * Reset the DVWA database (restores admin / password).
 * initDvwaDb() from helpers does not supply the CSRF user_token that
 * setup.php now requires, so we do it manually here.
 */
async function resetDb() {
  const res1 = await fetch(`${BASE}/setup.php`);
  const html1 = await res1.text();
  const tok = html1.match(/name='user_token'[^>]*value='([^']+)'/)?.[1] ?? '';
  const cookiesRaw = typeof res1.headers.getSetCookie === 'function'
    ? res1.headers.getSetCookie()
    : [];
  const cookieHeader = cookiesRaw.map((c) => c.split(';')[0]).join('; ');
  await fetch(`${BASE}/setup.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader },
    body: `create_db=Create+%2F+Reset+Database&user_token=${tok}`,
    redirect: 'follow',
  });
}

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-3-CSRF-Low', async () => {
  await waitForDvwa();
  await resetDb(); // ensure admin/password is intact before login
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  try {
    // Exploit: bare GET with no CSRF token at all — must be rejected when patched.
    const url = `${CSRF_URL}?password_new=hacked&password_conf=hacked&Change=Change`;
    const { status, text } = await dvwaFetch(url, { cookies });

    assert.equal(status, 200, 'patched CSRF endpoint should still serve a normal 200');
    assert.ok(
      !text.includes('Password Changed'),
      'CSRF low must be blocked: cross-site GET with no token must not change the password'
    );
  } finally {
    await resetDb(); // restore admin/password so later challenges can still log in
  }
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-3-CSRF-Medium', async () => {
  await waitForDvwa();
  await resetDb();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  try {
    // Exploit: spoofed Referer that passes DVWA's SERVER_NAME substring check. The check is
    // `stripos($_SERVER['HTTP_REFERER'], $_SERVER['SERVER_NAME']) !== false`, and SERVER_NAME
    // tracks the request Host — so the Referer MUST be built from BASE (a hardcoded
    // `http://localhost/...` does not contain the host the scorer uses, e.g. `app`, which makes
    // the unpatched server reject the forgery for the wrong reason and falsely score "patched").
    const url = `${CSRF_URL}?password_new=hacked&password_conf=hacked&Change=Change`;
    const { status, text } = await dvwaFetch(url, {
      cookies,
      headers: { Referer: `${BASE}${CSRF_URL}` },
    });

    assert.equal(status, 200, 'patched CSRF endpoint should still serve a normal 200');
    assert.ok(
      !text.includes('Password Changed'),
      'CSRF medium must be blocked: spoofed Referer must not be sufficient to change the password'
    );
  } finally {
    await resetDb(); // restore admin/password so later challenges can still log in
  }
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-3-CSRF-High', async () => {
  await waitForDvwa();
  await resetDb();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  try {
    // Harvest the per-session token from the CSRF page (same session, same origin).
    const { text: page } = await dvwaFetch(CSRF_URL, { cookies });
    const tokenMatch = page.match(/name=['"]user_token['"][^>]*value=['"]([^'"]+)['"]/);
    const token = tokenMatch ? tokenMatch[1] : '';

    assert.ok(token.length > 0, 'expected a user_token on the CSRF high page');

    // Exploit: replay the harvested token — must be rejected when patched (e.g. single-use or
    // bound to an origin/action so it cannot be reused for cross-site requests).
    const url = `${CSRF_URL}?password_new=hacked&password_conf=hacked&Change=Change&user_token=${token}`;
    const { status, text } = await dvwaFetch(url, { cookies });

    assert.equal(status, 200, 'patched CSRF endpoint should still serve a normal 200');
    assert.ok(
      !text.includes('Password Changed'),
      'CSRF high must be blocked: replaying a harvested per-session token must not change the password'
    );
  } finally {
    await resetDb(); // restore admin/password so later challenges can still log in
  }
});
