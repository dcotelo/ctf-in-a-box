import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// unauthorized read of hidden secret.json (no allowlist)

test('Challenge-72-Path-Traversal-Level-4', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_4', { params: { fileName: 'secret.json' } });
  assert.doesNotMatch(res.text, /Dummy|password|LEVEL_5/, 'patched: hidden secret.json must not be readable (allowlist enforced)');
});
