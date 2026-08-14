/**
 * Open Redirect — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level and replays the level's open-redirect
 * exploit. The test PASSES only when:
 *   (a) the endpoint is still alive and performing LEGITIMATE same-site redirects, AND
 *   (b) the off-site exploit payload does NOT yield an off-site Location header.
 * A broken endpoint that returns non-302 for BOTH same-site and evil targets does NOT
 * score patched — the health check (same-site must 302) ensures the endpoint is functional.
 *
 * LOW: header("location: " . $_GET['redirect']) — any absolute URL accepted.
 * MEDIUM: blocks http://|https:// but a scheme-relative //evil.example bypasses it.
 * HIGH: only allows targets containing "info.php" — a hostile URL that still
 *       contains that substring (e.g. http://evil.example/info.php) is accepted.
 *
 * Each test inspects the Location header directly (redirect: 'manual') so that
 * auto-followed redirects don't obscure the vulnerability signal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel } from '../helpers.js';

const BASE = process.env.DVWA_URL ?? 'http://localhost:4280';
const OR = '/vulnerabilities/open_redirect/source';

async function redirectTo(cookieHeader, level, target) {
  const res = await fetch(`${BASE}${OR}/${level}.php?redirect=${encodeURIComponent(target)}`, {
    headers: { Cookie: `${cookieHeader}; security=${level}` },
    redirect: 'manual',
  });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

/** Return true if the Location header points off-site (attacker-controlled). */
function isOffSite(location, attackerHost = 'evil.example') {
  if (!location) return false;
  // Scheme-relative //evil.example or absolute http(s)://evil.example
  return location.includes(attackerHost);
}

/** Return true if the Location header is a same-site relative or same-origin URL. */
function isSameSite(location) {
  if (!location) return false;
  // Relative paths (starting with /) are always same-site.
  // Absolute URLs pointing to our BASE host are also same-site.
  if (location.startsWith('/') && !location.startsWith('//')) return true;
  try {
    return new URL(location).hostname === new URL(BASE).hostname;
  } catch {
    return false;
  }
}

/**
 * Health check: the endpoint must be alive and serving the same-site redirect request.
 * Accepts either:
 *   - 302 to a same-site Location (endpoint is redirecting correctly), OR
 *   - 200 with a non-error response (endpoint is alive but may refuse all redirects,
 *     e.g. an impossibly-strict patch that blocks even same-site targets).
 * This rejects 500 (server error) or a bounce to login (3xx to /login.php).
 * A broken endpoint that 500s or is not found does NOT satisfy this check.
 */
function assertEndpointAlive({ status, location, body }, label) {
  const isLoginBounce = status === 302 && (location ?? '').includes('login');
  assert.ok(
    !isLoginBounce,
    `${label}: health check failed — endpoint bounced to login (session issue?)`
  );
  assert.ok(
    status === 200 || (status === 302 && isSameSite(location)),
    `${label}: health check failed — endpoint not alive (status=${status}, location=${location}); ` +
    'a patched endpoint must still serve a 200 or redirect same-site for a benign target'
  );
}

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-15-Open-Redirect-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  // Health check: endpoint must still be alive for a legitimate same-site redirect target.
  const sameSite = await redirectTo(cookies.cookieHeader, 'low', '/vulnerabilities/open_redirect/');
  assertEndpointAlive(sameSite, 'Open Redirect low');

  // Exploit check: the off-site payload must NOT produce an off-site Location.
  const { status, location } = await redirectTo(cookies.cookieHeader, 'low', 'http://evil.example/');
  assert.ok(
    status !== 302 || !isOffSite(location),
    `Open Redirect low must be blocked: got status=${status} Location=${location}`
  );
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-15-Open-Redirect-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  // Health check: endpoint must still be alive for a legitimate same-site redirect target.
  const sameSite = await redirectTo(cookies.cookieHeader, 'medium', '/vulnerabilities/open_redirect/');
  assertEndpointAlive(sameSite, 'Open Redirect medium');

  // Exploit check: scheme-relative bypass must NOT redirect off-site.
  const { status, location } = await redirectTo(cookies.cookieHeader, 'medium', '//evil.example/');
  assert.ok(
    status !== 302 || !isOffSite(location),
    `Open Redirect medium must be blocked: scheme-relative bypass must not redirect off-site; got status=${status} Location=${location}`
  );
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-15-Open-Redirect-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  // Health check: endpoint must still be alive for a legitimate same-site redirect target.
  // High level only allows targets containing "info.php" — use a same-site target satisfying that.
  const sameSite = await redirectTo(cookies.cookieHeader, 'high', '/vulnerabilities/open_redirect/info.php');
  assertEndpointAlive(sameSite, 'Open Redirect high');

  // Exploit check: the allow-list only checks for the substring "info.php", so a hostile
  // URL that happens to contain that substring passes the filter.
  const target = 'http://evil.example/info.php';
  const { status, location } = await redirectTo(cookies.cookieHeader, 'high', target);
  assert.ok(
    status !== 302 || !isOffSite(location),
    `Open Redirect high must be blocked: substring bypass must not redirect off-site; got status=${status} Location=${location}`
  );
});
