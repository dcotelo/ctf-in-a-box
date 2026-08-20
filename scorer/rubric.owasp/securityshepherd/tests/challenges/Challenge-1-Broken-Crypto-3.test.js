import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId, assertShepherdAlive,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-1-Broken-Crypto-3", async () => {
  // Weak XOR cipher: submitting the page's Base64 ciphertext decrypts to readable plaintext,
  // proving the home-grown encryption provides no confidentiality.
  const body = await ssPost('/challenges/2da053b4afb1530a500120a49a14d422ea56705a7e3fc405a77bc269948ccae1', cookies, {"userData": "IAAAAEkQBhEVBwpDHAFJGhYHSBYEGgocAw=="});
  // Anti-vacuous: the assertion below is satisfied by an empty body, a 404 or a
  // 500. Placed AFTER the exploit request so the challenge endpoint is still
  // exercised — a guard that returns first leaves nothing to measure (#106).
  await assertShepherdAlive(cookies);
  assert.doesNotMatch(body, /crypto is not strong/i, 'patched: the reversible XOR cipher must not reveal the recoverable plaintext secret');
});
