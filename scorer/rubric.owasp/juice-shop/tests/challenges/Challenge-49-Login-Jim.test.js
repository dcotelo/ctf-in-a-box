import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

// Logging in as Jim via SQL injection (email = "jim@...'--") must be impossible.
test('loginJimChallenge — SQLi login as Jim rejected', async () => {
  const res = await api('/rest/user/login', { method: 'POST', body: JSON.stringify({ email: "jim@juice-sh.op'--", password: 'x' }) });
  assert.notEqual(res.status, 200, 'SQLi login as Jim must not succeed');
  assert.ok(!res.body?.authentication?.token, 'no auth token should be issued');
});
