import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// username enumeration via distinct error messages

test('Challenge-4-Authentication-Level-7', async () => {
  const valid = await vaFetch('/AuthenticationVulnerability/LEVEL_7', { params: { username: 'admin_enum', password: 'wrong' } });
  const invalid = await vaFetch('/AuthenticationVulnerability/LEVEL_7', { params: { username: 'no_such_user_xyz', password: 'wrong' } });
  assert.notEqual(valid.json?.content, 'Invalid password', 'patched: must not reveal that the user exists via a distinct "Invalid password" message');
  assert.notEqual(invalid.json?.content, 'User not found', 'patched: must not reveal non-existent user via a distinct "User not found" message');
  assert.equal(valid.json?.content, invalid.json?.content, 'patched: valid and invalid usernames must yield identical messages (no enumeration)');
});
