import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// LDAP injection auth bypass via wildcard username

test('Challenge-66-LDAP-Injection-Level-3', async () => {
  const res = await vaFetch('/LDAPInjectionVulnerability/LEVEL_3', { params: { username: '*', password: 'alicePass123' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-66-ldap-injection-level-3');
  assert.notEqual(res.json?.isValid, true, 'patched: wildcard username must not bypass authentication');
});
