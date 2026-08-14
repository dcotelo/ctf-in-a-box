import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// unauthorized read of hidden secret.json (no allowlist)

test('Challenge-73-Path-Traversal-Level-5', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_5', { params: { fileName: 'secret.json' } });
  assert.doesNotMatch(res.text, /Dummy|password|LEVEL_5/, 'secret.json contents leaked — path traversal not blocked');
});
