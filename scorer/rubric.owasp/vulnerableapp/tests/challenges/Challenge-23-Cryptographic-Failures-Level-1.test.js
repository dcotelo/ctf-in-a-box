import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// plaintext password recovered from DB and accepted

test('Challenge-23-Cryptographic-Failures-Level-1', async () => {
  const res = await vaFetch('/CryptographicFailures/LEVEL_1', { params: { password: '1AU*>A#Uop' } });
  // NOTE: LEVEL_1 secret is read from the H2 DB (cryptographic_failures_user).
  // Vulnerability: the password is stored in plaintext and the response advertises that fact.
  // Patched: the response must no longer disclose plaintext-storage of the secret.
  assert.doesNotMatch(res.text, /plaintext/i, 'patched: response must not disclose plaintext password storage');
});
