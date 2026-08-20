import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// LDAP wildcard injection dumps all users

test('Challenge-64-LDAP-Injection-Level-1', async () => {
  const res = await vaFetch('/LDAPInjectionVulnerability/LEVEL_1', { params: { username: '*' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-64-ldap-injection-level-1');
  assert.ok(!(res.json?.isValid === true && Array.isArray(res.json?.content?.users) && res.json.content.users.length > 1), 'patched: wildcard injection must not dump multiple users');
  assert.ok(!(Array.isArray(res.json?.content?.users) && res.json.content.users.includes('alice')), 'patched: wildcard must not leak user alice');
});
