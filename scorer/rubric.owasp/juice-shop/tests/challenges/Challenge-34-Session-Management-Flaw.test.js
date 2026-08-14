import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

test('Challenge 15 — Session Management Flaw: password change without current password must be rejected', async () => {
  const token = await registerAndLogin({
    email: `ctf-c15-${Date.now()}@local.test`,
    password: 'CtfTester!23',
  });

  // Attempt to change password without providing currentPassword
  // Before patch: this succeeded if currentPassword was falsy (the `if (currentPassword && ...)` guard was skipped)
  // After patch: returns 401 because currentPassword is required
  const res = await api('/rest/user/change-password?new=HackedP%40ss1&repeat=HackedP%40ss1', {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.ok(
    res.status === 401,
    `Password change without current password should return 401, got ${res.status}: ${JSON.stringify(res.body)}`
  );
});

test('Challenge 15 — Session Management Flaw: password change with wrong current password must be rejected', async () => {
  const password = 'CtfTester!23';
  const token = await registerAndLogin({
    email: `ctf-c15b-${Date.now()}@local.test`,
    password,
  });

  const res = await api('/rest/user/change-password?current=WrongPassword&new=HackedP%40ss1&repeat=HackedP%40ss1', {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.ok(
    res.status === 401,
    `Password change with wrong current password should return 401, got ${res.status}`
  );
});
