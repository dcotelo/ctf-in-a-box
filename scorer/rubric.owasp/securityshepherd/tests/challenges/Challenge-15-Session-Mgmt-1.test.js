import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-15-Session-Mgmt-1", async () => {
  const forged = {
  "checksum": Buffer.from("userRole=administrator").toString('base64'),
};
  // Merge forged challenge cookies into the authenticated jar (no integrity protection on them).
  const jar = { ...cookies, ...forged };
  const body = await ssPost('/challenges/dfd6bfba1033fa380e378299b6a998c759646bd8aea02511482b8ce5d707f93a', jar, {});
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
