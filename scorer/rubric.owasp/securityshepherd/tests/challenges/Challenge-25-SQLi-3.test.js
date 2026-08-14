import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-25-SQLi-3", async () => {
  // UNION-based extraction of credit-card numbers; the secret card is the module result.
  const body = await ssPost('/challenges/b7327828a90da59df54b27499c0dc2e875344035e38608fcfb7c1ab8924923f6', cookies, {"theUserName": "' union select creditCardNumber from customers where '1'='1"});
  assert.doesNotMatch(body, /9815 1547 3214 7569/, 'patched: the exploit must not extract the secret card number');
});
