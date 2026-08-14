import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-22-Session-Mgmt-8", async () => {
  const forged = {
  "challengeRole": "nmHqLjQknlHs",
};
  // Merge forged challenge cookies into the authenticated jar (no integrity protection on them).
  const jar = { ...cookies, ...forged };
  const body = await ssPost('/challenges/714d8601c303bbef8b5cabab60b1060ac41f0d96f53b6ea54705bb1ea4316334', jar, {});
  const key = extractSolutionKey(body);
  assert.ok(!key, 'patched: the exploit must not solve the challenge / yield a result key');
});
