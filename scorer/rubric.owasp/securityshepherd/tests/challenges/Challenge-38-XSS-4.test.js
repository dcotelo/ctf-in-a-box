import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId, assertShepherdAlive,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-38-XSS-4", async () => {
  const body = await ssPost('/challenges/06f81ca93f26236112f8e31f32939bd496ffe8c9f7b564bce32bd5e3a8c2f751', cookies, {"searchTerm": "http\" href=javascript:alert(1) x=\""});
  const key = extractSolutionKey(body);
  // Anti-vacuous: the assertion below is satisfied by an empty body, a 404 or a
  // 500. Placed AFTER the exploit request so the challenge endpoint is still
  // exercised — a guard that returns first leaves nothing to measure (#106).
  await assertShepherdAlive(cookies);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
