import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// weak LM crypto material disclosed in response

test('Challenge-30-Cryptographic-Failures-Level-8', async () => {
  // The endpoint openly discloses the LM stored value & algorithm (A02 cryptographic failure).
  // Secrets are randomized per launch; the offline crack is the intended completion path.
  const res = await vaFetch('/CryptographicFailures/LEVEL_8');
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-30-cryptographic-failures-level-8');
  assert.doesNotMatch(res.text, /LM/i, 'patched: weak LM hash material must not be disclosed in the response');
});
