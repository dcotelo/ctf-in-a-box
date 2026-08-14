import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-34-URL-Access-3", async () => {
  const forged = {
  "currentPerson": Buffer.from("MrJohnReillyTheSecond").toString('base64'),
};
  // Merge forged challenge cookies into the authenticated jar (no integrity protection on them).
  const jar = { ...cookies, ...forged };
  const body = await ssPost('/challenges/e40333fc2c40b8e0169e433366350f55c77b82878329570efa894838980de5b4', jar, {});
  const key = extractSolutionKey(body);
  assert.ok(!key, 'patched: forging the cookie must not yield a result key');
});
