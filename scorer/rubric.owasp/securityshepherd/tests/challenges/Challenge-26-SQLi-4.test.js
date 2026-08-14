import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-26-SQLi-4", async () => {
  const body = await ssPost('/challenges/1feccf2205b4c5ddf743630b46aece3784d61adc56498f7603ccd7cb8ae92629', cookies, {"theUserName": "\\", "thePassword": " OR userName=0x61646d696e -- "});
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
