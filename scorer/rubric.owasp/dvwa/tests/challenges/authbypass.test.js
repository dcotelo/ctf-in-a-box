/**
 * Authorisation Bypass — pass-when-PATCHED (patch CTF).
 *
 * The vulnerability is function-level authorisation bypass: regular users should not be
 * able to call the admin-only backing API endpoints directly, but the stock implementation
 * does not enforce this at all levels.
 *
 * Exploit model: log in as a regular user (gordonb) and call the endpoints directly,
 * bypassing the UI access control.
 *
 *   - LOW  (stock): get_user_data.php leaks all user records to any authenticated user.
 *   - MEDIUM (stock): change_user_details.php performs writes for any authenticated user
 *                     — no admin check at medium.
 *   - HIGH  (stock): change_user_details.php still performs writes for any user — still
 *                     no admin check until impossible.
 *
 * "Patched" means the non-admin request is denied (no sensitive data / error result).
 * Tests pass ONLY when:
 *   (a) the endpoint is still functioning (admin gets the expected response), AND
 *   (b) the exploit is denied (gordonb does NOT get the sensitive response).
 * A broken endpoint that returns errors for BOTH admin and gordonb does NOT score patched.
 *
 * Subtest names equal the catalogue keys (authbypass-low/medium/high).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel } from '../helpers.js';

const BASE = process.env.DVWA_URL ?? 'http://localhost:4280';
const AB   = '/vulnerabilities/authbypass';

/** Call get_user_data.php as the given user session at the given security level. */
function getData(cookieHeader, level) {
  return fetch(`${BASE}${AB}/get_user_data.php`, {
    headers: { Cookie: `${cookieHeader}; security=${level}` },
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
}

/** Call change_user_details.php as the given user session at the given security level. */
function changeData(cookieHeader, level, payload) {
  return fetch(`${BASE}${AB}/change_user_details.php`, {
    method: 'POST',
    headers: { Cookie: `${cookieHeader}; security=${level}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
}

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-17-Authorisation-Bypass-Low', async () => {
  await waitForDvwa();

  // Health check: admin must still receive user records (endpoint is alive and functional).
  const adminCookies = await loginDvwa();
  await setSecurityLevel(adminCookies, 'low');
  const adminData = await getData(adminCookies.cookieHeader, 'low');
  assert.equal(
    adminData.status, 200,
    `Authbypass low health check: admin request to get_user_data.php must return 200 (got ${adminData.status})`
  );
  assert.ok(
    adminData.text.includes('user_id'),
    `Authbypass low health check: admin must receive user records from get_user_data.php (got: ${adminData.text.slice(0, 200)})`
  );

  // Exploit check: gordonb (non-admin) must NOT receive user records.
  const gordCookies = await loginDvwa({ username: 'gordonb', password: 'abc123' });
  await setSecurityLevel(gordCookies, 'low');
  const gordData = await getData(gordCookies.cookieHeader, 'low');
  assert.ok(
    gordData.status === 200,
    `Authbypass low: gordonb request must reach the endpoint (status=${gordData.status})`
  );
  assert.ok(
    !gordData.text.includes('Gordon') && !gordData.text.includes('user_id'),
    `Authbypass low must be patched: a regular user (gordonb) must not receive user records from get_user_data.php (got: ${gordData.text.slice(0, 200)})`
  );
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-17-Authorisation-Bypass-Medium', async () => {
  await waitForDvwa();

  // Health check: admin must still receive {"result":"ok"} (endpoint is alive).
  const adminCookies = await loginDvwa();
  await setSecurityLevel(adminCookies, 'medium');
  const adminRes = await changeData(adminCookies.cookieHeader, 'medium', { id: 2, first_name: 'Gordon', surname: 'Brown' });
  assert.equal(
    adminRes.status, 200,
    `Authbypass medium health check: admin request must return 200 (got ${adminRes.status})`
  );
  assert.ok(
    /"result"\s*:\s*"ok"/.test(adminRes.text),
    `Authbypass medium health check: admin must receive {"result":"ok"} from change_user_details.php (got: ${adminRes.text.slice(0, 200)})`
  );

  // Exploit check: gordonb must be denied.
  const gordCookies = await loginDvwa({ username: 'gordonb', password: 'abc123' });
  await setSecurityLevel(gordCookies, 'medium');
  const gordRes = await changeData(gordCookies.cookieHeader, 'medium', { id: 2, first_name: 'Gordon', surname: 'Brown' });
  assert.ok(
    !/"result"\s*:\s*"ok"/.test(gordRes.text),
    `Authbypass medium must be patched: a regular user must not receive {"result":"ok"} from change_user_details.php (got: ${gordRes.text.slice(0, 200)})`
  );
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-17-Authorisation-Bypass-High', async () => {
  await waitForDvwa();

  // Health check: admin must still receive {"result":"ok"} (endpoint is alive).
  const adminCookies = await loginDvwa();
  await setSecurityLevel(adminCookies, 'high');
  const adminRes = await changeData(adminCookies.cookieHeader, 'high', { id: 2, first_name: 'Gordon', surname: 'Brown' });
  assert.equal(
    adminRes.status, 200,
    `Authbypass high health check: admin request must return 200 (got ${adminRes.status})`
  );
  assert.ok(
    /"result"\s*:\s*"ok"/.test(adminRes.text),
    `Authbypass high health check: admin must receive {"result":"ok"} from change_user_details.php (got: ${adminRes.text.slice(0, 200)})`
  );

  // Exploit check: gordonb must be denied even at high level.
  const gordCookies = await loginDvwa({ username: 'gordonb', password: 'abc123' });
  await setSecurityLevel(gordCookies, 'high');
  const gordRes = await changeData(gordCookies.cookieHeader, 'high', { id: 2, first_name: 'Gordon', surname: 'Brown' });
  assert.ok(
    !/"result"\s*:\s*"ok"/.test(gordRes.text),
    `Authbypass high must be patched: a regular user must be denied by change_user_details.php at this level too (got: ${gordRes.text.slice(0, 200)})`
  );
});
