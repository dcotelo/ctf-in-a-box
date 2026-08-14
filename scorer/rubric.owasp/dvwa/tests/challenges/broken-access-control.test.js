/**
 * Broken Access Control (IDOR) — pass-when-PATCHED (patch CTF).
 *
 * The vulnerability is IDOR: a regular user should only be able to view their own profile,
 * but stock implementations allow forging access controls to view other users' profiles.
 *
 * Exploit model: log in as gordonb (user_id=2), then try to access admin's profile (user_id=1)
 * using the level's specific bypass.
 *
 *   - LOW  (stock): the only gate is a client-supplied user_id cookie — forge it to match
 *                   the target id (user_id=1) and the server grants access.
 *   - MEDIUM (stock): the only gate is a guessable static token "user_token" in the query
 *                     string — supply it and the server returns any profile.
 *   - HIGH (bac-high): NEEDS_REVIEW — the high level uses $_SESSION['user_id'] which binds
 *                      access to the server-side session. No reliable single-session IDOR
 *                      exploit exists: the bypass requires session fixation (two-party attack
 *                      where an attacker pre-sets a victim's session, then impersonates the
 *                      victim's established session_id). A single-session test cannot
 *                      distinguish "vulnerable" from "patched" here without flakiness.
 *
 * "Patched" means the IDOR request is denied: the profile-info block for the TARGET user
 * is absent from the response. Tests pass when the exploit signal is ABSENT, so returning
 * a 403 or a generic error page does NOT score (the 200 + absence check is what matters).
 *
 * Subtest names equal the catalogue keys (bac-low/medium/high).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel } from '../helpers.js';

const BASE = process.env.DVWA_URL ?? 'http://localhost:4280';
const BAC  = '/vulnerabilities/bac/';

/**
 * Request the BAC page as a non-admin user, trying to view another user's profile.
 * Returns { status, text }.
 */
function viewProfile(cookieHeader, level, userId, extraCookies = '', query = '') {
  const url = `${BASE}${BAC}?action=view&user_id=${userId}${query}`;
  return fetch(url, {
    headers: { Cookie: `${cookieHeader}; security=${level}${extraCookies}` },
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
}

/**
 * Signal: the TARGET user's (admin, user_id=1) specific data is disclosed.
 *
 * The generic `<div class="profile-info">` div is present even when the requesting
 * user's OWN profile is shown, so testing for it would false-fail a correctly
 * patched endpoint that returns the requester's own profile instead of the target's.
 *
 * We tighten the signal to admin-specific data: the admin user's name is "admin admin"
 * (first_name="admin", surname="admin") and avatar is "admin.jpg". Verified live against
 * stock DVWA: the vulnerable low/medium exploit for user_id=1 returns
 * `<p>Name: admin admin</p>` in the profile-info block.
 * A patched endpoint either denies access entirely or shows gordonb's OWN profile
 * (neither of which contains "Name: admin admin").
 */
const PROFILE_DISCLOSED = (t) => t.includes('Name: admin admin');

/**
 * Positive control: gordonb's OWN profile (user_id=2, "Gordon Brown") is disclosed.
 *
 * Asserting only the ABSENCE of admin's data would silently score "patched" whenever the IDOR
 * request fails to return ANY profile for a non-patch reason (a broken endpoint, a generic 200
 * error page, a missing seed). Requiring the requester's own profile first proves the endpoint
 * is alive and actually serving profile data, so an absent "Name: admin admin" can only mean the
 * cross-user access was denied (a real patch).
 */
const OWN_PROFILE = (t) => t.includes('Name: Gordon Brown');

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-18-Broken-Access-Control-Low', async () => {
  await waitForDvwa();
  // Log in as gordonb (user_id=2) — a regular, non-admin user.
  const cookies = await loginDvwa({ username: 'gordonb', password: 'abc123' });
  await setSecurityLevel(cookies, 'low');

  // Positive control: gordonb viewing their OWN profile (user_id=2) must return profile data —
  // proves the endpoint is alive and serving profiles before we trust the "admin absent" check.
  const own = await viewProfile(cookies.cookieHeader, 'low', 2, '; user_id=2');
  assert.equal(own.status, 200, 'BAC low positive control: own-profile request must return 200');
  assert.ok(
    OWN_PROFILE(own.text),
    'BAC low positive control: gordonb must see their own profile (endpoint must actually return profile data)'
  );

  // Stock exploit: forge the user_id cookie to 1 (admin) while requesting user_id=1.
  // The low level grants access whenever the cookie matches the query param — trivially forgeable.
  const res = await viewProfile(cookies.cookieHeader, 'low', 1, '; user_id=1');

  assert.equal(res.status, 200, 'patched BAC endpoint should still return a 200');
  assert.ok(
    !PROFILE_DISCLOSED(res.text),
    'BAC low must be patched: forging the user_id cookie must not reveal another user\'s profile-info'
  );
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-18-Broken-Access-Control-Medium', async () => {
  await waitForDvwa();
  // Log in as gordonb — a regular user.
  const cookies = await loginDvwa({ username: 'gordonb', password: 'abc123' });
  await setSecurityLevel(cookies, 'medium');

  // Positive control: gordonb viewing their OWN profile (user_id=2, with the static token) must
  // return profile data — proves the endpoint is alive before we trust the "admin absent" check.
  const own = await viewProfile(cookies.cookieHeader, 'medium', 2, '', '&token=user_token');
  assert.equal(own.status, 200, 'BAC medium positive control: own-profile request must return 200');
  assert.ok(
    OWN_PROFILE(own.text),
    'BAC medium positive control: gordonb must see their own profile (endpoint must actually return profile data)'
  );

  // Stock exploit: supply the hardcoded static token "user_token" in the query string.
  // Any user who reads the HTML comment "<!-- Try using token=user_token -->" can do this.
  const res = await viewProfile(cookies.cookieHeader, 'medium', 1, '', '&token=user_token');

  assert.equal(res.status, 200, 'patched BAC endpoint should still return a 200');
  assert.ok(
    !PROFILE_DISCLOSED(res.text),
    'BAC medium must be patched: the static token "user_token" must no longer grant access to another user\'s profile'
  );
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

// NEEDS_REVIEW — bac-high
//
// The high level uses $_SESSION['user_id'] as the access gate, which correctly binds
// profile access to the server-side session of the logged-in user. The documented
// vulnerability ("session fixation") requires a two-party scenario:
//   1. Attacker establishes a session (gets PHPSESSID) before the victim logs in.
//   2. Victim logs in using the attacker's PHPSESSID (session fixation).
//   3. $_SESSION['user_id'] is then set to the VICTIM's user_id on first use.
//   4. Attacker, holding the same PHPSESSID, can now query any user_id that matches
//      the victim's session-stored id.
//
// A single-session test cannot replicate this two-party attack without flakiness,
// and cannot reliably distinguish "stock-vulnerable" from "patched" state.
//
// The "broken-access-control-high" test in the old (non-inverted) file was hollow:
// it asserted 'User Profile' (the h2 page heading) which is present even on denied
// responses, making it a tautology. There is no reliable, non-flaky signal here.

