import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId, assertShepherdAlive,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-27-SQLi-5", async () => {
  // SQLi in the VIP-coupon checker dumps the secret 100%-off-orange coupon.
  const body = await ssPost('/challenges/8edf0a8ed891e6fef1b650935a6c46b03379a0eebab36afcd1d9076f65d4ce62VipCouponCheck', cookies, {"couponCode": "' UNION SELECT 1,2,GROUP_CONCAT(couponCode) FROM vipCoupons -- "});
  // Anti-vacuous: the assertion below is satisfied by an empty body, a 404 or a
  // 500. Placed AFTER the exploit request so the challenge endpoint is still
  // exercised — a guard that returns first leaves nothing to measure (#106).
  await assertShepherdAlive(cookies);
  assert.doesNotMatch(body, /Pse3cr3etCouponStu/i, `patched: the exploit must not leak the secret VIP coupon, got: ${body.slice(-200)}`);
});
