import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

// A UNION-based SQLi that fabricates a non-existent "accounting" user must not log in.
test('ephemeralAccountantChallenge — UNION SQLi login must be rejected', async () => {
  const inj = "' UNION SELECT * FROM (SELECT 15 as 'id', '' as 'username', 'acc0unt4nt@juice-sh.op' as 'email', '' as 'password', 'accounting' as 'role', '' as 'deluxeToken', '' as 'lastLoginIp', '/assets/public/images/uploads/default.svg' as 'profileImage', '' as 'totpSecret', 1 as 'isActive', '1999-08-16' as 'createdAt', '1999-08-16' as 'updatedAt', NULL as 'deletedAt') --";
  const res = await api('/rest/user/login', { method: 'POST', body: JSON.stringify({ email: inj, password: 'x' }) });
  assert.notEqual(res.status, 200, 'fabricated accountant login must not succeed');
  assert.ok(!res.body?.authentication?.token, 'no auth token should be issued');
});
