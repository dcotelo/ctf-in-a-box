import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVAmPI, vampiFetch, createDb, assertApiAlive } from '../helpers.js';

await createDb();
await waitForVAmPI();

// Pass-on-patch: drives the exploit (20 rapid failed logins) and asserts rate limiting is PRESENT.
// On the vulnerable app no request is throttled (every attempt served 200), so this FAILS; once a
// rate limiter is added some attempts are rejected (429 / lockout) -> PASSES.
await test('Challenge-9-No-Rate-Limit', async () => {
  // Anti-vacuous: a legitimate login must work before any "blocked" assertion
  // below can mean anything (docs/scorer.md, #47).
  await assertApiAlive('challenge-9-no-rate-limit');

  const attempts = 20;
  const results = await Promise.all(
    Array.from({ length: attempts }, () =>
      vampiFetch('/users/v1/login', { method: 'POST', body: { username: 'name1', password: 'wrongpass' } }),
    ),
  );

  // PATCHED: the burst must be visibly throttled. Requires either an explicit
  // 429, or a SUBSTANTIAL share of the burst refused.
  //
  // Deliberately not "any single response was not 200": twenty concurrent
  // requests at a just-booted container produce the occasional transient
  // error, and that phrasing let one blip award the point on a STOCK app —
  // observed as a flaky stock-scores-zero failure. Stock serves all twenty
  // with 200, so a real rate limiter is easy to distinguish; anything that
  // refuses a quarter of a rapid burst passes, whatever status it uses.
  const refused = results.filter((r) => r.status !== 200).length;
  const throttled = results.some((r) => r.status === 429) || refused >= 5;
  assert.ok(throttled,
    `rate limiting must be enforced: rapid brute-force login attempts must not all be served ` +
    `(${refused}/${attempts} refused, none with 429)`);
});
