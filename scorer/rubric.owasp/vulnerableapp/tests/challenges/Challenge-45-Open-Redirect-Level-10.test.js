import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// open redirect: attacker host injected into Location

test('Challenge-45-Open-Redirect-Level-10', async () => {
  const res = await vaFetch('/Http3xxStatusCodeBasedInjection/LEVEL_10?returnTo=http://evil.com', { redirect: 'manual' });
  assert.doesNotMatch(res.headers.get('location') || '', /evil\.com/, 'patched: must not redirect to attacker-controlled host');
});
