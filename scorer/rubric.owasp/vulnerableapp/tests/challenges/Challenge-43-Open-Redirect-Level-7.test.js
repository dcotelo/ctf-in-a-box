import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// open redirect: attacker host injected into Location

test('Challenge-43-Open-Redirect-Level-7', async () => {
  const res = await vaFetch('/Http3xxStatusCodeBasedInjection/LEVEL_7?returnTo=.evil.com', { redirect: 'manual' });
  assert.doesNotMatch(res.headers.get('location') || '', /evil\.com/, 'patched: must not redirect to attacker-controlled host');
});
