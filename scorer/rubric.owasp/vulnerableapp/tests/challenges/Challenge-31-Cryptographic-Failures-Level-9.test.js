import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// weak SHA-256 crypto material disclosed in response

test('Challenge-31-Cryptographic-Failures-Level-9', async () => {
  // The endpoint openly discloses the SHA-256 stored value & algorithm (A02 cryptographic failure).
  // Secrets are randomized per launch; the offline crack is the intended completion path.
  const res = await vaFetch('/CryptographicFailures/LEVEL_9');
  assert.doesNotMatch(res.text, /SHA-256 hash/i, 'patched: weak SHA-256 hash material must not be disclosed in the response');
});
