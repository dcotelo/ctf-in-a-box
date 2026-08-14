import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// open redirect: attacker host injected into Location

test('Challenge-38-Open-Redirect-Level-2', async () => {
  const res = await vaFetch('/Http3xxStatusCodeBasedInjection/LEVEL_2?returnTo=//evil.com', { redirect: 'manual' });
  assert.doesNotMatch(res.headers.get('location') || '', /evil\.com/, 'patched: must not redirect to attacker-controlled host');
});
