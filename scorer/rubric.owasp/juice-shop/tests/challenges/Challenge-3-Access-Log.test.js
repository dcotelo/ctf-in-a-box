import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

test('Challenge 3 — Access Log Disclosure: /support/logs must reject unauthenticated requests', async () => {
  const res = await api('/support/logs');
  assert.ok(
    [401, 403].includes(res.status),
    `/support/logs should return 401 or 403 without auth, got ${res.status}`
  );
});

test('Challenge 3 — Access Log Disclosure: /support/logs must reject non-admin authenticated requests', async () => {
  const token = await registerAndLogin({
    email: `ctf-c03-${Date.now()}@local.test`,
    password: 'CtfTester!23',
  });

  const res = await api('/support/logs', {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.ok(
    [401, 403].includes(res.status),
    `/support/logs should return 403 for non-admin users, got ${res.status}`
  );
});
