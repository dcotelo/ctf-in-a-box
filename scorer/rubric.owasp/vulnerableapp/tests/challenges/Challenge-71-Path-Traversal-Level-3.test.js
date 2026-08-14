import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// unauthorized read of hidden secret.json (no allowlist)

test('Challenge-71-Path-Traversal-Level-3', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_3', { params: { fileName: 'secret.json' } });
  assert.doesNotMatch(res.text, /Dummy|password|LEVEL_5/, 'patched: hidden secret.json must not be readable (allowlist enforced)');
});
