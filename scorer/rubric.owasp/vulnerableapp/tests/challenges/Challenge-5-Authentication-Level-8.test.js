import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// weak password (password123) accepted despite BCrypt

test('Challenge-5-Authentication-Level-8', async () => {
  const res = await vaFetch('/AuthenticationVulnerability/LEVEL_8', { method: 'POST', body: new URLSearchParams({ username: 'admin_weak', password: 'password123' }) });
  assert.notEqual(res.json?.isValid, true, 'weak password (password123) accepted — weak-password policy not enforced');
});
