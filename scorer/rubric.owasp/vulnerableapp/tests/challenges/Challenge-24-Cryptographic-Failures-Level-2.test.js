import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// base64 "encryption" trivially reversed

test('Challenge-24-Cryptographic-Failures-Level-2', async () => {
  const challenge = await vaFetch('/CryptographicFailures/LEVEL_2');
  const m = challenge.text.match(/stored password is: ([A-Za-z0-9+/=]+)/);
  assert.ok(m, 'challenge exposes the base64 value');
  const plaintext = Buffer.from(m[1], 'base64').toString('latin1');
  const res = await vaFetch('/CryptographicFailures/LEVEL_2', { params: { password: plaintext } });
  assert.doesNotMatch(res.text, /Correct/, 'patched: base64-decoded value must no longer be accepted as the password');
});
