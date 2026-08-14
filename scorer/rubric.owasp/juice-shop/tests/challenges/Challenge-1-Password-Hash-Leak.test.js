import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

const BASE = process.env.JUICE_SHOP_URL ?? 'http://localhost:3000';

test('Challenge 1 — Password Hash Leak: ?fields=password must not expose hash on /rest/user/whoami', async () => {
  const email = `ctf-c01-${Date.now()}@local.test`;
  const token = await registerAndLogin({ email, password: 'CtfTester!23' });

  // The vulnerability: GET /rest/user/whoami?fields=<field> uses the token cookie
  // to return arbitrary user data fields — including the hashed password.
  const res = await fetch(`${BASE}/rest/user/whoami?fields=password`, {
    headers: { Cookie: `token=${token}` },
  });

  assert.equal(res.status, 200, `Unexpected status from /rest/user/whoami: ${res.status}`);
  const body = await res.json();

  assert.ok(
    !body?.user?.password,
    `password hash exposed via ?fields=password on /rest/user/whoami — ` +
    `strip sensitive fields from the fields projection in routes/currentUser.ts`
  );
});

test('Challenge 1 — Password Hash Leak: ?fields=totpSecret must not expose TOTP secret', async () => {
  const email = `ctf-c01b-${Date.now()}@local.test`;
  const token = await registerAndLogin({ email, password: 'CtfTester!23' });

  const res = await fetch(`${BASE}/rest/user/whoami?fields=password,totpSecret`, {
    headers: { Cookie: `token=${token}` },
  });

  assert.equal(res.status, 200, `Unexpected status: ${res.status}`);
  const body = await res.json();

  assert.ok(
    !body?.user?.totpSecret,
    `totpSecret exposed via ?fields=totpSecret — strip it alongside password in currentUser.ts`
  );
});
