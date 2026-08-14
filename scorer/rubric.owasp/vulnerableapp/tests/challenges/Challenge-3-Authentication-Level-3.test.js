import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// plaintext password storage exposed in response

test('Challenge-3-Authentication-Level-3', async () => {
  const res = await vaFetch('/AuthenticationVulnerability/LEVEL_3', { params: { username: 'admin_plain', password: 'b7X$4nRj-6mW' } });
  assert.equal(res.json.isValid, true);
  // Vulnerability: the API leaks the stored plaintext password.
  // Patched: the response must not disclose the stored plaintext password.
  assert.notEqual(res.json?.content?.passwordInDB, 'b7X$4nRj-6mW', 'patched: stored plaintext password must not be leaked in the response');
});
