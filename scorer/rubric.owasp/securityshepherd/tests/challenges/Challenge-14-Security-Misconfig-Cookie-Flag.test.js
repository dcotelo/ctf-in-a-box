import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssGetRaw, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId, assertShepherdAlive,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-14-Security-Misconfig-Cookie-Flag", async () => {
  // Provision a second user, generate both users' insecure-flag cookies, then replay the
  // SECOND user's token from the admin session (cookie theft / replay).
  ensureSecondUser();
  const attacker = await loginAs(SECOND_USER, SECOND_PASS);
  // Trigger token creation by visiting the challenge JSP. The vulnerable JSP SETS the per-user
  // token as the `securityMisconfigLesson` cookie in the response — so the attacker's token is
  // handed straight back on the wire. Capturing it off the attacker's Set-Cookie IS the theft,
  // and needs no DB/docker access (previously read via
  // `SELECT token FROM securityMisconfigStealToken.tokens WHERE userId=<attackerId>`).
  const attackerVisit = await ssGetRaw(
    '/challenges/c4285bbc6734a10897d672c1ed3dd9417e0530a4e0186c27699f54637c7fb5d4.jsp', attacker);
  await ssGet('/challenges/c4285bbc6734a10897d672c1ed3dd9417e0530a4e0186c27699f54637c7fb5d4.jsp', cookies);
  let stolen = null;
  for (const header of attackerVisit.setCookie) {
    const [pair] = header.split(';');
    const idx = pair.indexOf('=');
    if (pair.slice(0, idx).trim() === 'securityMisconfigLesson') {
      stolen = pair.slice(idx + 1).trim();
      break;
    }
  }
  const jar = { ...cookies, securityMisconfigLesson: stolen };
  const body = await ssPost('/challenges/c4285bbc6734a10897d672c1ed3dd9417e0530a4e0186c27699f54637c7fb5d4', jar, {});
  const key = extractSolutionKey(body);
  // Anti-vacuous: the assertion below is satisfied by an empty body, a 404 or a
  // 500. Placed AFTER the exploit request so the challenge endpoint is still
  // exercised — a guard that returns first leaves nothing to measure (#106).
  await assertShepherdAlive(cookies);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
