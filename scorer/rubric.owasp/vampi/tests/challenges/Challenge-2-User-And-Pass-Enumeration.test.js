import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVAmPI, vampiFetch, createDb, assertApiAlive } from '../helpers.js';

await createDb();
await waitForVAmPI();

// Pass-on-patch: drives the exploit (compare unknown-user vs wrong-password login responses) and
// asserts username enumeration is BLOCKED. On the vulnerable app the two messages differ ("does not
// exist" vs "password is not correct"), so this FAILS; once login returns a single generic message
// it PASSES.
await test('Challenge-2-User-And-Pass-Enumeration', async () => {
  // Anti-vacuous: a legitimate login must work before any "blocked" assertion
  // below can mean anything (docs/scorer.md, #47).
  await assertApiAlive('challenge-2-user-and-pass-enumeration');

  const unknown = await vampiFetch('/users/v1/login', {
    method: 'POST',
    body: { username: 'definitely_not_a_user', password: 'x' },
  });
  const wrongPass = await vampiFetch('/users/v1/login', {
    method: 'POST',
    body: { username: 'name1', password: 'wrong-password' },
  });

  const unknownMsg = unknown.json?.message ?? unknown.text ?? '';
  const wrongMsg = wrongPass.json?.message ?? wrongPass.text ?? '';

  // Patched: the responses must not distinguish "user absent" from "wrong password".
  assert.doesNotMatch(unknownMsg, /does not exist/i, 'response must not reveal that the user does not exist');
  assert.equal(unknownMsg, wrongMsg, 'enumeration must be blocked: both cases must return the same generic message');
});
