import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

const BASE = process.env.JUICE_SHOP_URL ?? 'http://localhost:3000';

// The legacy-sanitizer bypass username must not produce a live <script> tag on the
// profile page, and #{...} usernames must never be evaluated server-side.
test('usernameXssChallenge — sanitizer-bypass username must not yield a script tag', async () => {
  const email = `ctf-uxss-${Date.now()}@local.test`;
  const token = await registerAndLogin({ email, password: 'CtfTester!23' });

  await fetch(`${BASE}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `token=${token}` },
    body: 'username=' + encodeURIComponent('<<a|ascript>alert(`xss`)</script>'),
  });

  const res = await fetch(`${BASE}/profile`, { headers: { Cookie: `token=${token}` } });
  const html = await res.text();
  assert.ok(!html.includes('<script>alert(`xss`)</script>'), 'profile page must not contain an injected <script> tag');
});

test('usernameXssChallenge — #{...} username must not be evaluated server-side', async () => {
  const email = `ctf-ssti-${Date.now()}@local.test`;
  const token = await registerAndLogin({ email, password: 'CtfTester!23' });

  await fetch(`${BASE}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `token=${token}` },
    body: 'username=' + encodeURIComponent('#{7*7}'),
  });

  const res = await fetch(`${BASE}/profile`, { headers: { Cookie: `token=${token}` } });
  const html = await res.text();
  assert.ok(!html.includes('>49<') && !html.includes('"49"'), 'server-side template expression must not be evaluated (no 49)');
});
