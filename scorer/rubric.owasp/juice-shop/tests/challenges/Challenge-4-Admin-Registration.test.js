import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

test('Challenge 4 — Admin Registration: registering with role=admin must create a customer account', async () => {
  const email = `ctf-c04-${Date.now()}@local.test`;
  const password = 'CtfTester!23';

  // The valid Juice Shop admin role string is 'admin', not 'administrator'.
  // The vulnerability: finale-rest passes role through to the Sequelize create
  // without stripping it, so any caller can register as an administrator.
  const res = await api('/api/Users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      passwordRepeat: password,
      role: 'admin',
      securityQuestion: null,
      securityAnswer: 'x',
    }),
  });

  assert.ok(
    [200, 201].includes(res.status),
    `Registration failed unexpectedly (${res.status}): ${JSON.stringify(res.body)}`
  );

  const createdRole = res.body?.data?.role;
  assert.notEqual(
    createdRole,
    'admin',
    `Registered user has role='admin' — patch server.ts to strip the role field ` +
    `in the User resource create.write.before hook`
  );
});
