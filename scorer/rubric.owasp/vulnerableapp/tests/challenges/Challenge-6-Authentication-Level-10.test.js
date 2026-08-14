import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// low-cost BCrypt (cost 4) weak password cracked

test('Challenge-6-Authentication-Level-10', async () => {
  const res = await vaFetch('/AuthenticationVulnerability/LEVEL_10', { method: 'POST', body: new URLSearchParams({ username: 'admin_lowcost', password: 'sunshine' }) });
  // Patched: weak password must NOT authenticate, and no low-cost BCrypt hash leaked.
  assert.notEqual(res.json?.isValid, true, 'weak password should not authenticate after patch');
  assert.doesNotMatch(String(res.json?.content?.passwordHash ?? ''), /^\$2a\$04\$/, 'low-cost BCrypt hash should not be leaked after patch');
});
