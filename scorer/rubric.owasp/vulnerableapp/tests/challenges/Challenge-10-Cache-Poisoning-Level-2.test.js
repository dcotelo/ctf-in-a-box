import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// cache poisoning bypasses naive script filter and persists

test('Challenge-10-Cache-Poisoning-Level-2', async () => {
  await vaFetch('/CachePoisoning/clearCache', { method: 'POST', body: new URLSearchParams({ level: 'LEVEL_2' }) });
  const marker = 'CPX2MARKER<img src=x onerror=alert(1)>';
  await vaFetch('/CachePoisoning/LEVEL_2', { params: { banner: marker } });
  const hit = await vaFetch('/CachePoisoning/LEVEL_2', { params: { banner: 'clean' } });
  assert.ok(!hit.text.includes('CPX2MARKER<img src=x onerror=alert(1)>'), 'poisoned payload served from cache — patch must key/sanitize cache');
});
