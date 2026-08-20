import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// path traversal reads adjacent module file

test('Challenge-69-Path-Traversal-Level-1', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_1', { params: { fileName: '../Authentication/db/data.sql' } });
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-69-path-traversal-level-1');
  assert.doesNotMatch(res.text, /auth_users|admin_sqli/, 'patched: traversal must not leak contents of adjacent module file');
});
