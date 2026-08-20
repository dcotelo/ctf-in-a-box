import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId, assertShepherdAlive,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-3-CSRF-1", async () => {
  // CSRF: a second (attacker) user forges a request that increments the admin victim's counter.
  ensureSecondUser();
  const attacker = await loginAs(SECOND_USER, SECOND_PASS);
  const adminId = getUserId('admin');
  // Admin must have opened the module and posted a message so the results row exists.
  await openModule(cookies, '20e755179a5840be5503d42bb3711716235005ea');
  await ssPost('/challenges/s74a796e84e25b854906d88f622170c1c06817e72b526b3d1e9a6085f429cf52', cookies, { myMessage: 'http://localhost/x' });
  // Attacker triggers the forged state-changing request:
  await ssGet('/user/csrfchallengeone/plusplus', attacker, { 'userid': adminId });
  // The admin's challenge page now reveals the key (isCsrfLevelComplete -> true).
  const page = await ssGet('/challenges/s74a796e84e25b854906d88f622170c1c06817e72b526b3d1e9a6085f429cf52.jsp', cookies);
  const key = (page.match(/[0-9A-F]{100,128}/) || [])[0];
  // Anti-vacuous: the assertion below is satisfied by an empty body, a 404 or a
  // 500. Placed AFTER the exploit request so the challenge endpoint is still
  // exercised — a guard that returns first leaves nothing to measure (#106).
  await assertShepherdAlive(cookies);
  assert.ok(!(/Challenge Completed|congrat/i.test(page) || key),
    'patched: the forged CSRF request must not complete the challenge / reveal the key');
});
