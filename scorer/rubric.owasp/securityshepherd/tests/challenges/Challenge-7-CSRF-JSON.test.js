import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-7-CSRF-JSON", async () => {
  // CSRF: a second (attacker) user forges a request that increments the admin victim's counter.
  ensureSecondUser();
  const attacker = await loginAs(SECOND_USER, SECOND_PASS);
  const adminId = getUserId('admin');
  // Admin must have opened the module and posted a message so the results row exists.
  await openModule(cookies, 'fcc1918e0a23b8420e173cf8029876cb887408d3');
  await ssPost('/challenges/2e0981dcb8278a57dcfaae3b8da0c78d5a70c2d38ea9d8b3e14db3aea01afcbb', cookies, { myMessage: 'http://localhost/x' });
  // Attacker triggers the forged state-changing request:
  await ssPostJson('/user/csrfchallengejson/plusplus', attacker, { 'userId': adminId });
  // The admin's challenge page now reveals the key (isCsrfLevelComplete -> true).
  const page = await ssGet('/challenges/2e0981dcb8278a57dcfaae3b8da0c78d5a70c2d38ea9d8b3e14db3aea01afcbb.jsp', cookies);
  const key = (page.match(/[0-9A-F]{100,128}/) || [])[0];
  assert.ok(!(/Challenge Completed|congrat/i.test(page) || key),
    'patched: the forged CSRF request must not complete the challenge / yield a result key');
});
