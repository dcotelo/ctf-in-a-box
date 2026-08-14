import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// weak MD4 crypto material disclosed in response

test('Challenge-27-Cryptographic-Failures-Level-5', async () => {
  // The endpoint openly discloses the MD4 stored value & algorithm (A02 cryptographic failure).
  // Secrets are randomized per launch; the offline crack is the intended completion path.
  const res = await vaFetch('/CryptographicFailures/LEVEL_5');
  assert.doesNotMatch(res.text, /MD4 hash/i, 'patched: weak MD4 hash material must not be disclosed in the response');
});
