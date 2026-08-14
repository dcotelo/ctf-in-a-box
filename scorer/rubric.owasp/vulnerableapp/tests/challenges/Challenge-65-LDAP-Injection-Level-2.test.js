import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// LDAP wildcard injection dumps all users

test('Challenge-65-LDAP-Injection-Level-2', async () => {
  const res = await vaFetch('/LDAPInjectionVulnerability/LEVEL_2', { params: { username: '*' } });
  assert.ok(!(res.json?.isValid === true && Array.isArray(res.json?.content?.users) && res.json.content.users.length > 1), 'patched: wildcard injection must not dump multiple users');
  assert.ok(!(Array.isArray(res.json?.content?.users) && res.json.content.users.includes('alice')), 'patched: wildcard must not leak user alice');
});
