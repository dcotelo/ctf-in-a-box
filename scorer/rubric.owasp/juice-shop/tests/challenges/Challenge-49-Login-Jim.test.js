import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer, assertShopAlive } from '../helpers.js';

await waitForServer();

// Logging in as Jim via SQL injection (email = "jim@...'--") must be impossible.
test('loginJimChallenge — SQLi login as Jim rejected', async () => {
  // Anti-vacuous: "not a 200" is exactly what a dead app returns, so the shop
  // has to be serving before a refusal can mean the SQLi was blocked
  // (docs/scorer.md, #47).
  await assertShopAlive();

  const res = await api('/rest/user/login', { method: 'POST', body: JSON.stringify({ email: "jim@juice-sh.op'--", password: 'x' }) });
  assert.notEqual(res.status, 200, 'SQLi login as Jim must not succeed');
  assert.ok(!res.body?.authentication?.token, 'no auth token should be issued');
});
