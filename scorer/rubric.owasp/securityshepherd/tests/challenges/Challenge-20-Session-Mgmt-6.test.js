import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-20-Session-Mgmt-6", async () => {
  // Account recovery via a guessable secret-question answer reveals the key.
  const body = await ssPost('/challenges/b5e1020e3742cf2c0880d4098146c4dde25ebd8ceab51807bad88ff47c316eceSecretQuestion', cookies,
    { subEmail: "buzzthebald@shepherd.com", subAnswer: "Aran Keegan" });
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
