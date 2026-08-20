import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertRedirected } from '../helpers.js';

await waitForVulnerableApp();

// open redirect: attacker host injected into Location

test('Challenge-45-Open-Redirect-Level-10', async () => {
  const res = await vaFetch('/Http3xxStatusCodeBasedInjection/LEVEL_10?returnTo=http://evil.com', { redirect: 'manual' });
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertRedirected(res, 'challenge-45-open-redirect-level-10');
  assert.doesNotMatch(res.headers.get('location') || '', /evil\.com/, 'patched: must not redirect to attacker-controlled host');
});
