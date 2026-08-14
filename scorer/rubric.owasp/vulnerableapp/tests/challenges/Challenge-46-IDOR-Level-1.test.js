import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// Pass-on-patch: the test drives the REAL IDOR exploit (a logged-in user reading another user's
// profile) and asserts it is BLOCKED. On the vulnerable app the cross-user read succeeds, so this
// FAILS; once the endpoint enforces server-side ownership/RBAC the read is denied and it PASSES.
// Seeded users: Alice(id 1), Bob(id 2), Charlie(id 3, ADMIN). Login password is the same for all.
async function loginToken(level) {
  const res = await vaFetch(`/IDORVulnerability/LEVEL_${level}`, {
    method: 'POST',
    body: new URLSearchParams({ username: 'Alice', password: 'P@ssw0rd!2026' }),
  });
  return res.json?.content?.token;
}

// patched: a logged-in user cannot read another user\'s profile (no-authorization IDOR blocked)

test('Challenge-46-IDOR-Level-1', async () => {
  const token = await loginToken(1);
  assert.ok(token, 'login must succeed to drive the exploit');
  // Alice (id 1) requests Bob (id 2). VULNERABLE: any valid token reads any id -> returns Bob.
  const res = await vaFetch('/IDORVulnerability/LEVEL_1', { params: { id: '2' }, headers: { Cookie: `token_level1=${token}` } });
  const body = JSON.stringify(res.json ?? {});
  assert.ok(!(res.json?.isValid === true && /"username":"Bob"/.test(body)),
    'IDOR must be blocked: Alice must not be able to read Bob\'s profile');
});
