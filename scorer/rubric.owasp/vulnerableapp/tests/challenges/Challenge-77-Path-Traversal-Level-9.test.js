import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// null-byte allowlist bypass reads secret.json

test('Challenge-77-Path-Traversal-Level-9', async () => {
  const res = await vaFetch('/PathTraversal/LEVEL_9?fileName=secret.json%00UserInfo.json');
  assert.doesNotMatch(res.text, /Dummy|password|LEVEL_5/, 'secret.json contents leaked via null-byte bypass — path traversal not blocked');
});
