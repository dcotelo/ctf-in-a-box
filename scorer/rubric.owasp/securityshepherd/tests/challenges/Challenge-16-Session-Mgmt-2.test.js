import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId, assertShepherdAlive,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-16-Session-Mgmt-2", async () => {
  // Reset admin's password via an unauthenticated reset keyed only on email; the new
  // (server-chosen) password is disclosed in the response, then log in as admin.
  const reset = await ssPost('/challenges/f5ddc0ed2d30e597ebacf5fdd117083674b19bb92ffc3499121b9e6a12c92959',
    cookies, { subEmail: 'zoidberg22@shepherd.com' });
  const newPw = (reset.match(/Changed To:\s*([-0-9A-Za-z]+)/) || [])[1];
  // Anti-vacuous: the assertion below is satisfied by an empty body, a 404 or a
  // 500. Placed AFTER the exploit request so the challenge endpoint is still
  // exercised — a guard that returns first leaves nothing to measure (#106).
  await assertShepherdAlive(cookies);
  assert.ok(newPw, `Expected disclosed new password, got: ${reset.slice(-160)}`);
  const body = await ssPost('/challenges/d779e34a54172cbc245300d3bc22937090ebd3769466a501a5e7ac605b9f34b7', cookies, { subName: 'admin', subPassword: newPw });
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
