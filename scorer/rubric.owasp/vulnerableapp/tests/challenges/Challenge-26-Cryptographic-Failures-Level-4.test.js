import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// custom cipher (reverse + base64) reversed

test('Challenge-26-Cryptographic-Failures-Level-4', async () => {
  const challenge = await vaFetch('/CryptographicFailures/LEVEL_4');
  const m = challenge.text.match(/custom logic: ([A-Za-z0-9+/=]+) /);
  assert.ok(m, 'challenge exposes the ciphertext');
  const decoded = Buffer.from(m[1], 'base64').toString('latin1');
  const pt = decoded.split('').reverse().join('');
  const res = await vaFetch('/CryptographicFailures/LEVEL_4', { params: { password: pt } });
  assert.doesNotMatch(res.text, /Correct/, 'patched: reverse+base64-decoded value must no longer be accepted as the password');
});
