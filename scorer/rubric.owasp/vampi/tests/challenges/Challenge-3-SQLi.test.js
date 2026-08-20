import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVAmPI, vampiFetch, createDb, assertApiAlive } from '../helpers.js';

await createDb();
await waitForVAmPI();

// Pass-on-patch: drives the SQLi (always-true OR in the username path param) and asserts it is
// BLOCKED. On the vulnerable app the injection returns a user row, so this FAILS; once the query is
// parameterized the injected string is treated as a literal username and no row is returned -> PASSES.
await test('Challenge-3-SQLi', async () => {
  // Anti-vacuous: a legitimate login must work before any "blocked" assertion
  // below can mean anything (docs/scorer.md, #47).
  await assertApiAlive('challenge-3-sqli');

  const inject = `nonexistent_user' OR '1'='1`;
  const res = await vampiFetch(`/users/v1/${encodeURIComponent(inject)}`);
  assert.ok(!(res.status === 200 && res.json?.username),
    'SQL injection must be blocked: an always-true OR must not return a user row');

  // Control (correct behavior on both vulnerable and patched): a real-but-absent username -> 404.
  const falseRes = await vampiFetch(`/users/v1/${encodeURIComponent(`nonexistent_user' AND '1'='2`)}`);
  assert.equal(falseRes.status, 404, 'a non-existent username returns no user');
});
