import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// SQL injection authentication bypass

test('Challenge-1-Authentication-Level-1', async () => {
  const res = await vaFetch('/AuthenticationVulnerability/LEVEL_1', { params: { username: 'admin_sqli', password: "' OR '1'='1' --" } });
  assert.notEqual(res.json?.isValid, true, 'SQLi auth bypass must be blocked by the patch');
  assert.notEqual(res.json?.content?.username, 'admin_sqli', 'SQLi auth bypass must not authenticate as admin_sqli');
});
