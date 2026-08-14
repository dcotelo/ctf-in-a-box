import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

test('Challenge 14 — Vulnerable Library / CAPTCHA Bypass: data export without captcha must be rejected', async () => {
  const token = await registerAndLogin({
    email: `ctf-c14-${Date.now()}@local.test`,
    password: 'CtfTester!23',
  });

  // Attempt to export data without first requesting an image captcha
  // Before patch: this succeeded (captchas[0] was undefined, so !captchas[0] was true → next())
  // After patch: this returns 401 (captcha is required)
  const res = await api('/rest/user/data-export', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ answer: 'anything', format: 'json' }),
  });

  assert.ok(
    res.status === 401,
    `Data export without captcha should return 401, got ${res.status}: ${JSON.stringify(res.body)}`
  );
});
