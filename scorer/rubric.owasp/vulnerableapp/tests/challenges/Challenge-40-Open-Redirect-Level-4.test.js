import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertRedirected } from '../helpers.js';

await waitForVulnerableApp();

// open redirect: attacker host injected into Location

test('Challenge-40-Open-Redirect-Level-4', async () => {
  const res = await vaFetch('/Http3xxStatusCodeBasedInjection/LEVEL_4?returnTo=/%09/evil.com', { redirect: 'manual' });
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertRedirected(res, 'challenge-40-open-redirect-level-4');
  assert.doesNotMatch(res.headers.get('location') || '', /evil\.com/, 'patched: must not redirect to attacker-controlled host');
});
