import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVAmPI, vampiFetch, getToken, createDb } from '../helpers.js';

await createDb();
await waitForVAmPI();

// Pass-on-patch: drives the exploit (register with admin:true) and asserts mass assignment is
// BLOCKED. On the vulnerable app the attacker self-promotes to admin, so this FAILS; once the
// register handler ignores the client-supplied admin flag the new user is a non-admin -> PASSES.
//
// The account is read back through /me using the account's OWN login token — NOT the
// /users/v1/_debug endpoint. /_debug is the target of Challenge-1 (Excessive Data Exposure); using
// it as the oracle coupled the two challenges, so patching Challenge-1 (forbidding /_debug) made this
// test falsely pass. /me only ever exposes the caller's own record, so it is a faithful, independent
// oracle for the admin flag.
await test('Challenge-4-Mass-Assignment', async () => {
  const username = `pwned_admin_${Date.now()}`;
  const password = 'pass';
  await vampiFetch('/users/v1/register', {
    method: 'POST',
    body: { username, password, email: 'x@x.com', admin: true },
  });

  // Log in as the freshly-registered account and read its own profile.
  const token = await getToken(username, password);
  const me = await vampiFetch('/me', { token });

  assert.notEqual(me.json?.data?.admin, true,
    'mass assignment must be blocked: a client-supplied admin:true must not promote the account');
});
