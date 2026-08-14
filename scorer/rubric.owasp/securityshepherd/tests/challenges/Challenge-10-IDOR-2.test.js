import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-10-IDOR-2", async () => {
  const body = await ssPost('/challenges/vc9b78627df2c032ceaf7375df1d847e47ed7abac2a4ce4cb6086646e0f313a4', cookies, {"userId[]": "c51ce410c124a10e0db5e4b97fc2af39"});
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
