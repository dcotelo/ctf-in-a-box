import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVAmPI, vampiFetch, forgeJwt, createDb } from '../helpers.js';

await createDb();
await waitForVAmPI();

// Pass-on-patch: drives the exploit (forge an admin token with the hardcoded weak key "random") and
// asserts it is BLOCKED. On the vulnerable app the forged token authenticates as admin, so this
// FAILS; once the server uses a strong/secret key the forged token is rejected -> PASSES.
await test('Challenge-7-Weak-JWT', async () => {
  const forged = forgeJwt('admin', { secret: 'random' });
  const res = await vampiFetch('/me', { token: forged });
  assert.ok(!(res.status === 200 && res.json?.data?.admin === true),
    'weak JWT must be blocked: a token forged with the known weak key must not authenticate as admin');

  // Control (correct on both vulnerable and patched): a wrong-key token is rejected.
  const badRes = await vampiFetch('/me', { token: forgeJwt('admin', { secret: 'not-the-real-key' }) });
  assert.equal(badRes.status, 401, 'a token signed with the wrong key must be rejected');
});
