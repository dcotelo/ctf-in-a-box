import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// permissive X-Frame-Options: ALLOWALL

test('Challenge-14-Clickjacking-Level-2', async () => {
  const res = await vaFetch('/ClickjackingVulnerability/LEVEL_2');
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-14-clickjacking-level-2');
  assert.notEqual((res.headers.get('x-frame-options') || '').toUpperCase(), 'ALLOWALL', 'permissive X-Frame-Options: ALLOWALL — patch must set DENY/SAMEORIGIN');
});
