import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId, assertShepherdAlive,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-6-CSRF-4", async () => {
  // CSRF: a second (attacker) user forges a request that increments the admin victim's counter.
  ensureSecondUser();
  const attacker = await loginAs(SECOND_USER, SECOND_PASS);
  const adminId = getUserId('admin');
  // Admin must have opened the module and posted a message so the results row exists.
  await openModule(cookies, 'cfbf7b915ee56508ad46ab79878f37fd9afe0d27');
  await ssPost('/challenges/84118752e6cd78fecc3563ba2873d944aacb7b72f28693a23f9949ac310648b5', cookies, { myMessage: 'http://localhost/x' });
  // Attacker triggers the forged state-changing request:
  await ssPost('/user/csrfchallengefour/plusplus', attacker, { 'userId': adminId });
  // The admin's challenge page now reveals the key (isCsrfLevelComplete -> true).
  const page = await ssGet('/challenges/84118752e6cd78fecc3563ba2873d944aacb7b72f28693a23f9949ac310648b5.jsp', cookies);
  const key = (page.match(/[0-9A-F]{100,128}/) || [])[0];
  // Anti-vacuous: the assertion below is satisfied by an empty body, a 404 or a
  // 500. Placed AFTER the exploit request so the challenge endpoint is still
  // exercised — a guard that returns first leaves nothing to measure (#106).
  await assertShepherdAlive(cookies);
  assert.ok(!(/Challenge Completed|congrat/i.test(page) || key),
    'patched: the exploit must not solve the challenge / yield a result key');
});
