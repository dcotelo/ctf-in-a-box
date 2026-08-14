import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// path traversal reads adjacent module file

test('Challenge-69-Path-Traversal-Level-1', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_1', { params: { fileName: '../Authentication/db/data.sql' } });
  assert.doesNotMatch(res.text, /auth_users|admin_sqli/, 'patched: traversal must not leak contents of adjacent module file');
});
