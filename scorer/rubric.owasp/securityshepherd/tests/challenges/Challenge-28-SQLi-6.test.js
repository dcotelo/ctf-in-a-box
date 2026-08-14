import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-28-SQLi-6", async () => {
  const body = await ssPost('/challenges/d0e12e91dafdba4825b261ad5221aae15d28c36c7981222eb59f7fc8d8f212a2', cookies, {"pinNumber": "\\x27 UNION SELECT userAnswer FROM users WHERE userName=0x4272656e64616e -- "});
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
