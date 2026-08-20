import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// SSRF to cloud metadata endpoint (file:// blocked)

test('Challenge-90-SSRF-Level-2', async () => {
  const res = await vaFetch('/SSRFVulnerability/LEVEL_2', { params: { fileurl: 'http://169.254.169.254/latest/meta-data' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-90-ssrf-level-2');
  assert.doesNotMatch(res.text, /ami-id|instance-id|meta-data/, 'cloud metadata must not be reachable after patch');
});
