import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// LDAP unauthenticated user enumeration (non-parameterized)

test('Challenge-67-LDAP-Injection-Level-4', async () => {
  const valid = await vaFetch('/LDAPInjectionVulnerability/LEVEL_4', { params: { username: 'alice' } });
  const invalid = await vaFetch('/LDAPInjectionVulnerability/LEVEL_4', { params: { username: 'zz_no_such_user' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(valid, 'challenge-67-ldap-injection-level-4');
  assert.ok(!(valid.json?.isValid === true && Array.isArray(valid.json?.content?.users) && valid.json.content.users.includes('alice') && invalid.json?.isValid === false), 'patched: must not enumerate users (existing vs non-existing username must be indistinguishable)');
});
