import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// unauthorized read of hidden secret.json (no allowlist)

test('Challenge-71-Path-Traversal-Level-3', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_3', { params: { fileName: 'secret.json' } });
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-71-path-traversal-level-3');
  assert.doesNotMatch(res.text, /Dummy|password|LEVEL_5/, 'patched: hidden secret.json must not be readable (allowlist enforced)');
});
