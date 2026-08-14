/**
 * Weak Session IDs — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level and asserts that the issued dvwaSession IDs are NOT
 * predictable in the way the stock (vulnerable) implementation allows:
 *   - LOW (stock): sequential integer — each POST increments by exactly 1.
 *   - MEDIUM (stock): raw unix timestamp from time() — value falls within a clock window.
 *   - HIGH (stock): MD5 of a sequential counter — md5("1"), md5("2"), …
 *
 * "Patched" means the issued IDs break those specific predictability properties.
 * Tests pass when the exploit signal is ABSENT (no predictability), so a contestant
 * who merely breaks the endpoint does not score (the cookie must still be issued).
 *
 * Subtest names equal the catalogue keys (weak_id-low/medium/high).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { waitForDvwa, loginDvwa, setSecurityLevel } from '../helpers.js';

const BASE       = process.env.DVWA_URL ?? 'http://localhost:4280';
const WEAK_ID_URL = '/vulnerabilities/weak_id/';

const md5 = (s) => createHash('md5').update(String(s)).digest('hex');

/**
 * POST to the weak_id page and return the dvwaSession value from Set-Cookie.
 * Uses redirect:'manual' so the freshly-issued cookie is observable before
 * any redirect clobbers it.
 */
async function newSession(cookieHeader, level) {
  const res = await fetch(`${BASE}${WEAK_ID_URL}`, {
    method: 'POST',
    headers: { Cookie: `${cookieHeader}; security=${level}` },
    redirect: 'manual',
  });
  const sc = res.headers.get('set-cookie') || '';
  const m  = sc.match(/dvwaSession=([^;,\s]+)/);
  return m ? m[1] : null;
}

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-9-Weak-Session-IDs-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  const id1 = await newSession(cookies.cookieHeader, 'low');
  const id2 = await newSession(cookies.cookieHeader, 'low');

  // Positive control: the endpoint must issue a fresh, DISTINCT session id on each POST — proving
  // the weak-session code path is actually exercised. Without this, a broken endpoint that returns
  // the same constant cookie twice yields a difference of 0, which `!== 1` would silently accept as
  // "patched". A non-numeric (genuinely unpredictable) id still makes the diff NaN below and passes.
  assert.ok(id1 && id2, 'Weak ID low must still issue a dvwaSession cookie after patching');
  assert.notEqual(
    id1, id2,
    `Weak ID low positive control: each POST must issue a distinct dvwaSession (endpoint must regenerate per request; got ${id1}, ${id2})`
  );
  assert.notEqual(
    Number(id2) - Number(id1),
    1,
    `Weak ID low is patched: consecutive IDs must NOT differ by exactly 1 (got ${id1}, ${id2})`
  );
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-9-Weak-Session-IDs-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  const before = Math.floor(Date.now() / 1000) - 5;
  const id     = await newSession(cookies.cookieHeader, 'medium');
  const after  = Math.floor(Date.now() / 1000) + 5;

  assert.ok(id, 'Weak ID medium must still issue a dvwaSession cookie after patching');
  const value  = Number(id);
  const isPredictableTimestamp =
    Number.isInteger(value) && value >= before && value <= after;
  assert.ok(
    !isPredictableTimestamp,
    `Weak ID medium is patched: session must NOT be a predictable unix timestamp (got ${id}, window ${before}-${after})`
  );
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-9-Weak-Session-IDs-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  const id1 = await newSession(cookies.cookieHeader, 'high');
  const id2 = await newSession(cookies.cookieHeader, 'high');

  assert.ok(id1 && id2, 'Weak ID high must still issue dvwaSession cookies after patching');

  // Stock vulnerability: id1 = md5(N), id2 = md5(N+1) for some small N.
  // Patched: either the IDs are no longer 32-char hex, or they are not md5(counter)-pairs.
  let stockCounterFound = false;
  if (/^[a-f0-9]{32}$/.test(id1)) {
    // Brute-force a small counter range to see if id1 is md5(N) for any small N.
    for (let i = 1; i <= 10_000; i++) {
      if (md5(i) === id1) {
        // id1 looks like md5(N); check that id2 is NOT md5(N+1).
        if (md5(i + 1) === id2) {
          stockCounterFound = true;
        }
        break;
      }
    }
  }

  assert.ok(
    !stockCounterFound,
    `Weak ID high is patched: consecutive sessions must NOT be md5(N)/md5(N+1) for a small N (got ${id1}, ${id2})`
  );
});
