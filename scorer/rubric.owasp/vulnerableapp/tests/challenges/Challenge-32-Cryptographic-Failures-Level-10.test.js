import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// weak AES-128 crypto material disclosed in response

test('Challenge-32-Cryptographic-Failures-Level-10', async () => {
  // The endpoint openly discloses the AES-128 stored value & algorithm (A02 cryptographic failure).
  // Secrets are randomized per launch; the offline crack is the intended completion path.
  const res = await vaFetch('/CryptographicFailures/LEVEL_10');
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-32-cryptographic-failures-level-10');
  assert.doesNotMatch(res.text, /AES-128/i, 'patched: weak AES-128 algorithm/material must not be disclosed in the response');
});
