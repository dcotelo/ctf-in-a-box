import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-2-Broken-Crypto-4", async () => {
  const body = await ssPost('/challenges/b927fc4d8c9f70a78f8b6fc46a0cc18533a88b2363054a1f391fe855954d12f9', cookies, {"pineappleAmount": "0", "orangeAmount": "2", "appleAmount": "0", "bananaAmount": "0", "couponCode": "e!c!3etZoumo@Stu4rU176"});
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
