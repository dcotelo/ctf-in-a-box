import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// weak MD5 crypto material disclosed in response

test('Challenge-28-Cryptographic-Failures-Level-6', async () => {
  // The endpoint openly discloses the MD5 stored value & algorithm (A02 cryptographic failure).
  // Secrets are randomized per launch; the offline crack is the intended completion path.
  const res = await vaFetch('/CryptographicFailures/LEVEL_6');
  assert.doesNotMatch(res.text, /MD5 hash/i, 'patched: weak MD5 hash material must not be disclosed in the response');
});
