import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// personalized content cached publicly, served to other users

test('Challenge-12-Cache-Poisoning-Level-4', async () => {
  await vaFetch('/CachePoisoning/clearCache', { method: 'POST', body: new URLSearchParams({ level: 'LEVEL_4' }) });
  await vaFetch('/CachePoisoning/LEVEL_4', { headers: { Cookie: 'demo_user=cpx4_victim' } });
  // A different user's request returns the first user's cached personalized dashboard.
  const hit = await vaFetch('/CachePoisoning/LEVEL_4', { headers: { Cookie: 'demo_user=someone_else' } });
  assert.doesNotMatch(hit.text, /cpx4_victim/, 'first user personalized content served to a different user from cache — patch must not cache personalized content publicly');
});
