import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVAmPI, vampiFetch, createDb } from '../helpers.js';

await createDb();
await waitForVAmPI();

// Pass-on-patch: drives the exploit (unauth GET /users/v1/_debug) and asserts the excessive data
// exposure is BLOCKED. On the vulnerable app the endpoint returns every user's cleartext password
// + admin flag, so this FAILS; once the endpoint is removed/authorized or stops returning secrets
// it PASSES.
await test('Challenge-1-Excessive-Data-Exposure', async () => {
  const res = await vampiFetch('/users/v1/_debug');
  const leaks =
    res.status === 200 &&
    Array.isArray(res.json?.users) &&
    res.json.users.some((u) => 'password' in u || 'admin' in u);
  assert.ok(!leaks, 'excessive data exposure must be blocked: /_debug must not leak passwords/admin flags');
});
