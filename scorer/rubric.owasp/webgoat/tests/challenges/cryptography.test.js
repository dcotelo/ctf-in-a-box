/**
 * Cryptography — A04:2025 Cryptographic Failures. Pass-on-patch (inverted).
 *
 * Static secrets, weak hashing, base64-as-encryption, and signature verification.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

await test('Challenge-63-Crypto-Signing', async () => {
  // Fetch the session RSA private key, derive the public modulus exactly as Java's
  // BigInteger.toByteArray() (leading 0x00 when high bit set), and sign the modulus hex.
  const pem = (await wgFetch('/crypto/signing/getprivate', { cookies })).text.trim();
  const key = crypto.createPrivateKey(pem);
  const pub = crypto.createPublicKey(key);
  const jwk = pub.export({ format: 'jwk' });
  let n = Buffer.from(jwk.n, 'base64url');
  if (n[0] & 0x80) n = Buffer.concat([Buffer.from([0]), n]); // Java sign byte
  const modHex = n.toString('hex').toUpperCase();
  const sig = crypto.sign('sha256', Buffer.from(modHex, 'utf8'), key).toString('base64');
  const res = await wgFetch('/crypto/signing/verify', {
    cookies, method: 'POST', body: new URLSearchParams({ modulus: modHex, signature: sig }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
