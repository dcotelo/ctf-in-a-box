import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-12-Poor-Validation-1", async () => {
  const body = await ssPost('/challenges/ca0e89caf3c50dbf9239a0b3c6f6c17869b2a1e2edc3aa6f029fd30925d66c7e', cookies, {"pineappleAmount": "-100", "orangeAmount": "1", "appleAmount": "0", "bananaAmount": "0"});
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
