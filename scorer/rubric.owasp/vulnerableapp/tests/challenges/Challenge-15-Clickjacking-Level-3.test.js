import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// X-Frame-Options: SAMEORIGIN allows same-origin framing

test('Challenge-15-Clickjacking-Level-3', async () => {
  const res = await vaFetch('/ClickjackingVulnerability/LEVEL_3');
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-15-clickjacking-level-3');
  assert.notEqual((res.headers.get('x-frame-options') || '').toUpperCase(), 'SAMEORIGIN', 'X-Frame-Options: SAMEORIGIN allows same-origin framing — patch must set DENY');
});
