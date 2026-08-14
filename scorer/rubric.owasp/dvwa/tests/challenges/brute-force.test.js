/**
 * Brute Force — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level (selecting the low/medium/high source the contestant
 * patches) and replays the level's brute-force exploit. The test passes only when the app
 * still serves a normal 200 AND the welcome-area indicator does NOT appear — so a contestant
 * who merely breaks the page does not score "patched". Subtest names equal the catalogue keys
 * (brute-low/medium/high) so the scorer can isolate each level.
 *
 * LOW/MEDIUM: GET-based login with no rate limiting / lockout.
 * HIGH: Anti-CSRF token required per request — scraped from the page, still brute-forceable
 *       because tokens are not per-attempt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch } from '../helpers.js';

const BRUTE_USER = 'gordonb';
const BRUTE_PASS = 'abc123';      // gordonb's known weak password — a classic DVWA brute target
const BRUTE_URL  = '/vulnerabilities/brute/';

/** Scrape a CSRF user_token from a page's HTML. */
function scrapeToken(html) {
  const m = html.match(/name=['"]user_token['"][^>]*value=['"]([^'"]+)['"]/);
  return m ? m[1] : '';
}

/** Signal: "Welcome to the password protected area" confirms a successful brute-force login. */
const WELCOMED = (t) => t.includes('Welcome to the password protected area');

/** The brute login form — its presence proves the response came from the real, functional page. */
const LOGIN_FORM = /name=['"]username['"]/;

/**
 * Positive control shared by every brute subtest.
 *
 * A "pass-when-patched" check that only asserts the ABSENCE of the welcome banner silently scores
 * "patched" whenever the scripted guess fails for a NON-patch reason — a missing seed user, the
 * wrong endpoint, or a broken page. Guard against that before trusting an absent banner:
 *   1. the target credential is genuinely valid — gordonb/abc123 authenticates through the NORMAL
 *      login.php, independent of the brute endpoint (loginDvwa throws if the seed user is gone);
 *   2. the guess actually reached the real brute page — its login form is in the response.
 * With both satisfied, an absent welcome banner can only mean the level rejected the scripted
 * guess (a real patch) rather than the exploit never firing.
 */
async function assertExploitArmed(guessText, label) {
  await loginDvwa({ username: BRUTE_USER, password: BRUTE_PASS }); // throws if the seed credential is invalid
  assert.match(
    guessText, LOGIN_FORM,
    `${label} positive control: the brute login form must be present (the guess must hit the real, functional endpoint)`
  );
}

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-1-Brute-Force-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  // Replay the exploit: GET with the known credential, no token needed.
  const { status, text } = await dvwaFetch(
    `${BRUTE_URL}?username=${BRUTE_USER}&password=${BRUTE_PASS}&Login=Login`, { cookies });

  assert.equal(status, 200, 'patched brute endpoint should still serve a normal 200');
  await assertExploitArmed(text, 'Brute low');
  assert.ok(!WELCOMED(text),
    'Brute low must be blocked: scripted GET with the correct credential must not reach the welcome area');
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-1-Brute-Force-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  // Medium adds a trivial sleep(2) on failure — irrelevant to a single correct-guess probe.
  const { status, text } = await dvwaFetch(
    `${BRUTE_URL}?username=${BRUTE_USER}&password=${BRUTE_PASS}&Login=Login`, { cookies });

  assert.equal(status, 200, 'patched brute endpoint should still serve a normal 200');
  await assertExploitArmed(text, 'Brute medium');
  assert.ok(!WELCOMED(text),
    'Brute medium must be blocked: the trivial sleep delay does not constitute lockout — scripted guess must be stopped');
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-1-Brute-Force-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  // Scrape the CSRF token from the brute page (the realistic exploit step — reuse the same
  // token for the credential guess, which works at stock because tokens are not per-attempt).
  const { text: page } = await dvwaFetch(BRUTE_URL, { cookies });
  const token = scrapeToken(page);
  assert.ok(token.length > 0, 'Should be able to scrape a user_token from the brute page');

  const { status, text } = await dvwaFetch(
    `${BRUTE_URL}?username=${BRUTE_USER}&password=${BRUTE_PASS}&Login=Login&user_token=${token}`,
    { cookies });

  assert.equal(status, 200, 'patched brute endpoint should still serve a normal 200');
  await assertExploitArmed(text, 'Brute high');
  assert.ok(!WELCOMED(text),
    'Brute high must be blocked: a single-use or per-attempt token (or lockout) must prevent this scripted guess from succeeding');
});
