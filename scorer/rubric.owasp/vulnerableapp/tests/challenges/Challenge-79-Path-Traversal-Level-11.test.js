import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// null-byte allowlist bypass reads secret.json

test('Challenge-79-Path-Traversal-Level-11', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_11?fileName=secret.json%00UserInfo.json');
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-79-path-traversal-level-11');
  assert.doesNotMatch(res.text, /Dummy|password|LEVEL_5/, 'secret.json contents leaked via null-byte bypass — path traversal not blocked');
});
