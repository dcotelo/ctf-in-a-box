import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// Caesar cipher (shift 3) trivially reversed

test('Challenge-25-Cryptographic-Failures-Level-3', async () => {
  const challenge = await vaFetch('/CryptographicFailures/LEVEL_3');
  const m = challenge.text.match(/insecure cipher: ([^ ]+) /);
  assert.ok(m, 'challenge exposes the ciphertext');
  const ct = m[1];
  let pt = '';
  for (const ch of ct) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) pt += String.fromCharCode((c - 65 - 3 + 26) % 26 + 65);
    else if (c >= 97 && c <= 122) pt += String.fromCharCode((c - 97 - 3 + 26) % 26 + 97);
    else pt += ch;
  }
  const res = await vaFetch('/CryptographicFailures/LEVEL_3', { params: { password: pt } });
  assert.doesNotMatch(res.text, /Correct/, 'patched: Caesar-decrypted value must no longer be accepted as the password');
});
