import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-21-Session-Mgmt-7", async () => {
  // Account recovery via a guessable secret-question answer reveals the key.
  const body = await ssPost('/challenges/269d55bc0e0ff635dcaeec8533085e5eae5d25e8646dcd4b05009353c9cf9c80SecretQuestion', cookies,
    { subEmail: "buzzthebald@shepherd.com", subAnswer: "Gibraltar Campion" });
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
