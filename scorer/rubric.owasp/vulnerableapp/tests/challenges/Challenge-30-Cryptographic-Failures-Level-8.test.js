import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// weak LM crypto material disclosed in response

test('Challenge-30-Cryptographic-Failures-Level-8', async () => {
  // The endpoint openly discloses the LM stored value & algorithm (A02 cryptographic failure).
  // Secrets are randomized per launch; the offline crack is the intended completion path.
  const res = await vaFetch('/CryptographicFailures/LEVEL_8');
  assert.doesNotMatch(res.text, /LM/i, 'patched: weak LM hash material must not be disclosed in the response');
});
