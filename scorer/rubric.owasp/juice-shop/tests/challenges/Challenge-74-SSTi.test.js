import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

const BASE = process.env.JUICE_SHOP_URL ?? 'http://localhost:3000';

// The username must never be evaluated as a server-side template. A #{...} payload
// must not be executed (no SSTI / RCE).
test('sstiChallenge — username template expression must not be evaluated', async () => {
  const email = `ctf-ssti-${Date.now()}@local.test`;
  const token = await registerAndLogin({ email, password: 'CtfTester!23' });

  await fetch(`${BASE}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `token=${token}` },
    body: 'username=' + encodeURIComponent('#{6*7}'),
  });

  const res = await fetch(`${BASE}/profile`, { headers: { Cookie: `token=${token}` } });
  const html = await res.text();
  assert.ok(!/>\s*42\s*</.test(html) && !html.includes('"42"'), 'SSTI expression #{6*7} must not evaluate to 42');
});
