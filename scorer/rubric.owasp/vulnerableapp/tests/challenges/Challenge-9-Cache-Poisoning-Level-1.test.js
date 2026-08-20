import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// web cache poisoning: reflected banner persists across requests

test('Challenge-9-Cache-Poisoning-Level-1', async () => {
  await vaFetch('/CachePoisoning/clearCache', { method: 'POST', body: new URLSearchParams({ level: 'LEVEL_1' }) });
  const marker = 'CPX1MARKER';
  await vaFetch('/CachePoisoning/LEVEL_1', { params: { banner: marker } });
  // Cache key is route-only: a request with a DIFFERENT banner returns the poisoned cached content.
  const hit = await vaFetch('/CachePoisoning/LEVEL_1', { params: { banner: 'totally-different' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(hit, 'challenge-9-cache-poisoning-level-1');
  assert.doesNotMatch(hit.text, new RegExp(marker), 'poisoned banner served from cache to a different request — patch must key/sanitize cache');
});
