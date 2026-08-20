import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// path traversal via URL-encoded slash bypass

test('Challenge-70-Path-Traversal-Level-2', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_2?fileName=..%2fAuthentication%2fdb%2fschema.sql');
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-70-path-traversal-level-2');
  assert.doesNotMatch(res.text, /auth_users|CREATE TABLE/i, 'patched: URL-encoded traversal must not leak schema.sql contents');
});
