import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// Pass-on-patch: drives the REAL IDOR exploit (privilege escalation via a trusted role cookie) and
// asserts it is BLOCKED. LEVEL_3 trusts a client-supplied `role_level3` cookie; a plain USER sets it
// to ADMIN and reads any id. Alice logs in (USER), forges role_level3=ADMIN, reads Charlie (id 3):
// VULNERABLE -> returns Charlie; PATCHED -> derives the role from the signed token and denies.
async function loginToken(level) {
  const res = await vaFetch(`/IDORVulnerability/LEVEL_${level}`, {
    method: 'POST',
    body: new URLSearchParams({ username: 'Alice', password: 'P@ssw0rd!2026' }),
  });
  return res.json?.content?.token;
}

// patched: forging the role cookie to ADMIN cannot read another user (JWT/role-tampering IDOR blocked)

test('Challenge-48-IDOR-Level-3', async () => {
  const token = await loginToken(3);
  assert.ok(token, 'login must succeed to drive the exploit');
  // Alice (USER) forges role_level3=ADMIN and requests Charlie (id 3). VULNERABLE: returns Charlie.
  const res = await vaFetch('/IDORVulnerability/LEVEL_3', { params: { id: '3' }, headers: { Cookie: `token_level3=${token}; role_level3=ADMIN` } });
  const body = JSON.stringify(res.json ?? {});
  assert.ok(!(res.json?.isValid === true && /"username":"Charlie"/.test(body)),
    'IDOR must be blocked: a forged ADMIN role cookie must not read Charlie\'s profile');
});
