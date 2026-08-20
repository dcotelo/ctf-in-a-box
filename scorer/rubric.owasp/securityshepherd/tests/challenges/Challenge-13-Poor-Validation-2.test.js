import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId, assertShepherdAlive,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-13-Poor-Validation-2", async () => {
  const body = await ssPost('/challenges/20e8c4bb50180fed9c1c8d1bf6af5eac154e97d3ce97e43257c76e73e3bbe5d5', cookies, {"pineappleAmount": "100000000", "orangeAmount": "1", "appleAmount": "0", "bananaAmount": "0"});
  const key = extractSolutionKey(body);
  // Anti-vacuous: the assertion below is satisfied by an empty body, a 404 or a
  // 500. Placed AFTER the exploit request so the challenge endpoint is still
  // exercised — a guard that returns first leaves nothing to measure (#106).
  await assertShepherdAlive(cookies);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
