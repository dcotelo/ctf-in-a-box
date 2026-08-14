import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// web cache poisoning: reflected banner persists across requests

test('Challenge-9-Cache-Poisoning-Level-1', async () => {
  await vaFetch('/CachePoisoning/clearCache', { method: 'POST', body: new URLSearchParams({ level: 'LEVEL_1' }) });
  const marker = 'CPX1MARKER';
  await vaFetch('/CachePoisoning/LEVEL_1', { params: { banner: marker } });
  // Cache key is route-only: a request with a DIFFERENT banner returns the poisoned cached content.
  const hit = await vaFetch('/CachePoisoning/LEVEL_1', { params: { banner: 'totally-different' } });
  assert.doesNotMatch(hit.text, new RegExp(marker), 'poisoned banner served from cache to a different request — patch must key/sanitize cache');
});
