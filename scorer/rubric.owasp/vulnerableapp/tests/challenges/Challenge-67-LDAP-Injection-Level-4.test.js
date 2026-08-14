import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// LDAP unauthenticated user enumeration (non-parameterized)

test('Challenge-67-LDAP-Injection-Level-4', async () => {
  const valid = await vaFetch('/LDAPInjectionVulnerability/LEVEL_4', { params: { username: 'alice' } });
  const invalid = await vaFetch('/LDAPInjectionVulnerability/LEVEL_4', { params: { username: 'zz_no_such_user' } });
  assert.ok(!(valid.json?.isValid === true && Array.isArray(valid.json?.content?.users) && valid.json.content.users.includes('alice') && invalid.json?.isValid === false), 'patched: must not enumerate users (existing vs non-existing username must be indistinguishable)');
});
