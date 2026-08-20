import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// weak MD5 crypto material disclosed in response

test('Challenge-28-Cryptographic-Failures-Level-6', async () => {
  // The endpoint openly discloses the MD5 stored value & algorithm (A02 cryptographic failure).
  // Secrets are randomized per launch; the offline crack is the intended completion path.
  const res = await vaFetch('/CryptographicFailures/LEVEL_6');
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-28-cryptographic-failures-level-6');
  assert.doesNotMatch(res.text, /MD5 hash/i, 'patched: weak MD5 hash material must not be disclosed in the response');
});
