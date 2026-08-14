/**
 * SQL Injection — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level (selecting the low/medium/high source the contestant
 * patches) and replays the level's UNION exploit. The test passes only when the app still
 * serves a normal 200 AND the sensitive DB identity (user()/@@version) does NOT leak — so a
 * contestant who merely breaks the page does not score "patched". Subtest names equal the
 * catalogue keys (sqli-low/medium/high) so the scorer can isolate each level.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch } from '../helpers.js';

const SQLI = '/vulnerabilities/sqli/';
const LEAKED = (t) => /dvwa@|mariadb/i.test(t); // user()@host / @@version markers

await test('Challenge-7-SQL-Injection-Low', async () => {
  await waitForDvwa();
  const c = await loginDvwa();
  await setSecurityLevel(c, 'low');
  const { status, text } = await dvwaFetch(
    `${SQLI}?id=-1' UNION SELECT user(),@@version-- -&Submit=Submit`, { cookies: c });
  assert.equal(status, 200, 'patched sqli endpoint should still serve a normal 200');
  assert.ok(!LEAKED(text), 'SQLi low must be blocked: UNION payload must not leak DB identity');
});

await test('Challenge-7-SQL-Injection-Medium', async () => {
  await waitForDvwa();
  const c = await loginDvwa();
  await setSecurityLevel(c, 'medium');
  const { status, text } = await dvwaFetch(SQLI, {
    cookies: c, method: 'POST',
    body: new URLSearchParams({ id: '-1 UNION SELECT user(),@@version#', Submit: 'Submit' }),
  });
  assert.equal(status, 200, 'patched sqli endpoint should still serve a normal 200');
  assert.ok(!LEAKED(text), 'SQLi medium must be blocked: unquoted numeric UNION must not leak');
});

await test('Challenge-7-SQL-Injection-High', async () => {
  await waitForDvwa();
  const c = await loginDvwa();
  await setSecurityLevel(c, 'high');
  await dvwaFetch(`${SQLI}session-input.php`, {
    cookies: c, method: 'POST',
    body: new URLSearchParams({ id: "0' UNION SELECT user(),@@version#", Submit: 'Submit' }),
  });
  const { status, text } = await dvwaFetch(SQLI, { cookies: c });
  assert.equal(status, 200, 'patched sqli endpoint should still serve a normal 200');
  assert.ok(!LEAKED(text), 'SQLi high must be blocked: session-seeded UNION must not leak');
});
