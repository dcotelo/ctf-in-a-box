import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// unkeyed X-Forwarded-Host poisons cached asset URL

test('Challenge-11-Cache-Poisoning-Level-3', async () => {
  await vaFetch('/CachePoisoning/clearCache', { method: 'POST', body: new URLSearchParams({ level: 'LEVEL_3' }) });
  await vaFetch('/CachePoisoning/LEVEL_3', { params: { banner: 'k' }, headers: { 'X-Forwarded-Host': 'evil.attacker.com' } });
  // The poisoned host is cached and served on a later request WITHOUT the header.
  const hit = await vaFetch('/CachePoisoning/LEVEL_3', { params: { banner: 'k' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(hit, 'challenge-11-cache-poisoning-level-3');
  assert.doesNotMatch(hit.text, /evil\.attacker\.com/, 'poisoned X-Forwarded-Host served from cache without the header — patch must key/ignore the header');
});
