import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// LDAP injection auth bypass via wildcard username

test('Challenge-68-LDAP-Injection-Level-5', async () => {
  const res = await vaFetch('/LDAPInjectionVulnerability/LEVEL_5', { params: { username: '*', password: 'alicePass123' } });
  assert.notEqual(res.json?.isValid, true, 'patched: wildcard username must not bypass authentication');
});
