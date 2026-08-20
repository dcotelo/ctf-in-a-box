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

  // PATCHED: at least one attempt must be throttled (429) or otherwise not served a plain 200.
  const throttled = results.some((r) => r.status === 429) || !results.every((r) => r.status === 200);
  assert.ok(throttled,
    'rate limiting must be enforced: rapid brute-force login attempts must not all be served');
});
