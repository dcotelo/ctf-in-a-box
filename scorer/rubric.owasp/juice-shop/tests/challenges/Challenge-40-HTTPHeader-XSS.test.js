import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

const IFRAME = '<iframe src="javascript:alert(`xss`)">';

// The attacker-controllable True-Client-IP header must be sanitized before being
// persisted as the user's last-login IP.
test('httpHeaderXssChallenge — True-Client-IP header must be sanitized', async () => {
  const token = await registerAndLogin({ email: `ctf-hhx-${Date.now()}@local.test`, password: 'CtfTester!23' });

  const res = await api('/rest/saveLoginIp', {
    headers: { Authorization: `Bearer ${token}`, 'True-Client-IP': IFRAME },
  });

  const ip = res.body?.lastLoginIp ?? res.body?.data?.lastLoginIp ?? '';
  assert.ok(!String(ip).includes(IFRAME), `last-login IP must not contain the iframe payload, got: ${ip}`);
});
