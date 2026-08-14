import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

test('Challenge 5 — Admin Section: /api/Users list must be restricted to administrators', async () => {
  const token = await registerAndLogin({
    email: `ctf-c05-${Date.now()}@local.test`,
    password: 'CtfTester!23',
  });

  const res = await api('/api/Users', {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.ok(
    [401, 403].includes(res.status),
    `/api/Users list should return 403 for non-admin users, got ${res.status}`
  );
});

test('Challenge 5 — Admin Section: /api/Users list must be inaccessible without authentication', async () => {
  const res = await api('/api/Users');
  assert.ok(
    [401, 403].includes(res.status),
    `/api/Users list should return 401 without auth, got ${res.status}`
  );
});
