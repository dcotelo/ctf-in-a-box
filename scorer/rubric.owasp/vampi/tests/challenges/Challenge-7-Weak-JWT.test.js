import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVAmPI, vampiFetch, forgeJwt, getToken, createDb } from '../helpers.js';

await createDb();
await waitForVAmPI();

// Pass-on-patch: drives the exploit (forge an admin token with the hardcoded weak key "random") and
// asserts it is BLOCKED. On the vulnerable app the forged token authenticates as admin, so this
// FAILS; once the server uses a strong/secret key the forged token is rejected -> PASSES.
await test('Challenge-7-Weak-JWT', async () => {
  // Anti-vacuous precondition: prove the /me admin oracle is actually LIVE via a legitimate
  // admin login before trusting the block assertion. The forged-token check ("must NOT be
  // admin") passes for the wrong reason if /me can't report admin:true for anyone — e.g. a
  // not-ready or unseeded app where the admin account is missing. Without this guard a seeding
  // race lets the exploit "appear blocked" and hands a free point on the STOCK app (a
  // stock-scores-zero violation). A real admin token is unaffected by the weak-key fix — it is
  // issued and validated with whatever key the server uses — so this precondition holds on both
  // the vulnerable and the patched app, and fails LOUDLY only when the oracle itself is dead.
  const legitAdmin = await getToken('admin', 'pass1');
  const legit = await vampiFetch('/me', { token: legitAdmin });
  assert.equal(legit.status, 200,
    'precondition: a legitimate admin login must reach /me (app seeded and reachable)');
  assert.equal(legit.json?.data?.admin, true,
    'precondition: /me must report admin:true for a real admin token — otherwise the block test below is vacuous');

  const forged = forgeJwt('admin', { secret: 'random' });
  const res = await vampiFetch('/me', { token: forged });
  assert.ok(!(res.status === 200 && res.json?.data?.admin === true),
    'weak JWT must be blocked: a token forged with the known weak key must not authenticate as admin');

  // Control (correct on both vulnerable and patched): a wrong-key token is rejected.
  const badRes = await vampiFetch('/me', { token: forgeJwt('admin', { secret: 'not-the-real-key' }) });
  assert.equal(badRes.status, 401, 'a token signed with the wrong key must be rejected');
});
