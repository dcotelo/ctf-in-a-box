import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// null-byte allowlist bypass reads secret.json

test('Challenge-76-Path-Traversal-Level-8', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_8?fileName=secret.json%00UserInfo.json');
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-76-path-traversal-level-8');
  assert.doesNotMatch(res.text, /Dummy|password|LEVEL_5/, 'secret.json contents leaked via null-byte bypass — path traversal not blocked');
});
