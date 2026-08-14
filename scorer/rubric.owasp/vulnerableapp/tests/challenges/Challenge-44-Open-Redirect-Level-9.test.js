import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// open redirect: attacker host injected into Location

test('Challenge-44-Open-Redirect-Level-9', async () => {
  const res = await vaFetch('/Http3xxStatusCodeBasedInjection/LEVEL_9?returnTo=http://evil.com', { redirect: 'manual' });
  assert.doesNotMatch(res.headers.get('location') || '', /evil\.com/, 'patched: must not redirect to attacker-controlled host');
});
