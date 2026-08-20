import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// unauthorized read of hidden secret.json (no allowlist)

test('Challenge-74-Path-Traversal-Level-6', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_6', { params: { fileName: 'secret.json' } });
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-74-path-traversal-level-6');
  assert.doesNotMatch(res.text, /Dummy|password|LEVEL_5/, 'secret.json contents leaked — path traversal not blocked');
});
