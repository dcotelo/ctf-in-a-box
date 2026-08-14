import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// Pass-on-patch: drives the REAL IDOR exploit (broken RBAC via a base64-encoded role cookie) and
// asserts it is BLOCKED. LEVEL_4 trusts a client-supplied `role_level4` cookie (base64url("ADMIN")).
// Alice logs in (USER), forges the encoded ADMIN role, reads Charlie (id 3): VULNERABLE -> returns
// Charlie; PATCHED -> derives the role server-side from the token and denies.
const ADMIN_B64 = Buffer.from('ADMIN', 'utf8').toString('base64url'); // QURNSU4

async function loginToken(level) {
  const res = await vaFetch(`/IDORVulnerability/LEVEL_${level}`, {
    method: 'POST',
    body: new URLSearchParams({ username: 'Alice', password: 'P@ssw0rd!2026' }),
  });
  return res.json?.content?.token;
}

// patched: a forged base64 ADMIN role cookie cannot read another user (broken-RBAC IDOR blocked)

test('Challenge-49-IDOR-Level-4', async () => {
  const token = await loginToken(4);
  assert.ok(token, 'login must succeed to drive the exploit');
  // Alice (USER) forges role_level4=base64url(ADMIN) and requests Charlie (id 3). VULNERABLE: Charlie.
  const res = await vaFetch('/IDORVulnerability/LEVEL_4', { params: { id: '3' }, headers: { Cookie: `token_level4=${token}; role_level4=${ADMIN_B64}` } });
  const body = JSON.stringify(res.json ?? {});
  assert.ok(!(res.json?.isValid === true && /"username":"Charlie"/.test(body)),
    'IDOR must be blocked: a forged base64 ADMIN role cookie must not read Charlie\'s profile');
});
