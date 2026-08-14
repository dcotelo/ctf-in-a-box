import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

// Logging in as Bender via SQL injection must be impossible.
test('loginBenderChallenge — SQLi login as Bender rejected', async () => {
  const res = await api('/rest/user/login', { method: 'POST', body: JSON.stringify({ email: "bender@juice-sh.op'--", password: 'x' }) });
  assert.notEqual(res.status, 200, 'SQLi login as Bender must not succeed');
  assert.ok(!res.body?.authentication?.token, 'no auth token should be issued');
});
