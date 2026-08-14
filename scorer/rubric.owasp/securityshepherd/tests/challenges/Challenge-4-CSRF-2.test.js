import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-4-CSRF-2", async () => {
  // CSRF: a second (attacker) user forges a request that increments the admin victim's counter.
  ensureSecondUser();
  const attacker = await loginAs(SECOND_USER, SECOND_PASS);
  const adminId = getUserId('admin');
  // Admin must have opened the module and posted a message so the results row exists.
  await openModule(cookies, '94cd2de560d89ef59fc450ecc647ff4d4a55c15d');
  await ssPost('/challenges/z311736498a13604705d608fb3171ebf49bc18753b0ec34b8dff5e4f9147eb5e', cookies, { myMessage: 'http://localhost/x' });
  // Attacker triggers the forged state-changing request:
  await ssPost('/user/csrfchallengetwo/plusplus', attacker, { 'userId': adminId });
  // The admin's challenge page now reveals the key (isCsrfLevelComplete -> true).
  const page = await ssGet('/challenges/z311736498a13604705d608fb3171ebf49bc18753b0ec34b8dff5e4f9147eb5e.jsp', cookies);
  const key = (page.match(/[0-9A-F]{100,128}/) || [])[0];
  assert.ok(!(/Challenge Completed|congrat/i.test(page) || key),
    'patched: the forged CSRF request must not complete the challenge / reveal the key');
});
