import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// weak SHA1 crypto material disclosed in response

test('Challenge-29-Cryptographic-Failures-Level-7', async () => {
  // The endpoint openly discloses the SHA1 stored value & algorithm (A02 cryptographic failure).
  // Secrets are randomized per launch; the offline crack is the intended completion path.
  const res = await vaFetch('/CryptographicFailures/LEVEL_7');
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-29-cryptographic-failures-level-7');
  assert.doesNotMatch(res.text, /SHA1 hash/i, 'patched: weak SHA1 hash material must not be disclosed in the response');
});
