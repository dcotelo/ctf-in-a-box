import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// Pass-on-patch: drives the REAL IDOR exploit (cookie tampering) and asserts it is BLOCKED.
// LEVEL_2 trusts a client-supplied `userId_level2` cookie. Alice logs in, then tampers the cookie
// to Bob's id (2): VULNERABLE -> returns Bob; PATCHED -> derives the user from the signed token and
// ignores the tampered cookie, so Bob is not returned. Seeded: Alice(1), Bob(2), Charlie(3 ADMIN).
async function loginToken(level) {
  const res = await vaFetch(`/IDORVulnerability/LEVEL_${level}`, {
    method: 'POST',
    body: new URLSearchParams({ username: 'Alice', password: 'P@ssw0rd!2026' }),
  });
  return res.json?.content?.token;
}

// patched: tampering the userId cookie cannot read another user (cookie-tampering IDOR blocked)

test('Challenge-47-IDOR-Level-2', async () => {
  const token = await loginToken(2);
  assert.ok(token, 'login must succeed to drive the exploit');
  // Alice tampers userId_level2 -> 2 (Bob). VULNERABLE: returns Bob.
  const res = await vaFetch('/IDORVulnerability/LEVEL_2', { headers: { Cookie: `token_level2=${token}; userId_level2=2` } });
  const body = JSON.stringify(res.json ?? {});
  assert.ok(!(res.json?.isValid === true && /"username":"Bob"/.test(body)),
    'IDOR must be blocked: a tampered userId cookie must not read Bob\'s profile');
});
