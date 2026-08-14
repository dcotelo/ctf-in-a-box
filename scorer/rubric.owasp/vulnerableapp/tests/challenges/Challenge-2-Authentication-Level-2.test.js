import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// login with DB-leaked plaintext password (logged in plaintext)

test('Challenge-2-Authentication-Level-2', async () => {
  const res = await vaFetch('/AuthenticationVulnerability/LEVEL_2', { params: { username: 'admin_logs', password: 'v9K#2mLp!8zQ' } });
  assert.notEqual(res.json?.isValid, true, 'login succeeded with DB-leaked plaintext password — patch must not store/accept plaintext-logged creds');
  assert.notEqual(res.json?.content?.username, 'admin_logs', 'authenticated session returned for leaked creds — patch must reject');
});
