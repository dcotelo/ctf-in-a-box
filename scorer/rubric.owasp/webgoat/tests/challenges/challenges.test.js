/**
 * WebGoat Challenges 1/5/7/8 + flag submission (ChallengeIntro). Pass-on-patch (inverted).
 *
 * Original contract: each challenge yields a UUID flag; submitting it to /challenge/flag/{N}
 * marks the challenge solved. These tests are INVERTED to pass only when the exploit is BLOCKED:
 * the exploit request bytes are unchanged, but each subtest now asserts the lesson is NOT solved
 * and that no flag is leaked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted, BASE , assertAttackResult, assertLessonOverview } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

await test('Challenge-78-XSS-Stego-Challenge', async () => {
  // The 4-digit PIN is steganographically embedded at bytes 81216-81219 of the logo image.
  const logo = await fetch(`${BASE}/challenge/logo`, { headers: { Cookie: cookies.cookieHeader } });
  const bytes = Buffer.from(await logo.arrayBuffer());
  const pin = String.fromCharCode(bytes[81216], bytes[81217], bytes[81218], bytes[81219]);
  const password = `!!webgoat_admin_${pin}!!`;
  const res = await wgFetch('/challenge/1', {
    cookies, method: 'POST', body: new URLSearchParams({ username: 'admin', password }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
  const flag = UUID.exec(res.json?.feedback ?? '')?.[0];
  assert.ok(!flag, 'patched: no flag must be leaked by the exploit');
});

await test('Challenge-79-SQL-Injection-Challenge', async () => {
  // SQL injection in password_login (username must be Larry).
  const res = await wgFetch('/challenge/5', {
    cookies, method: 'POST',
    body: new URLSearchParams({ username_login: 'Larry', password_login: "' OR '1'='1" }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
  const flag = UUID.exec(res.json?.feedback ?? '')?.[0];
  assert.ok(!flag, 'patched: no flag must be leaked by the SQL-injection exploit');
});

await test('Challenge-80-Password-Reset-Git-Challenge', async () => {
  // The admin reset-password link is hardcoded; GET it to retrieve the flag.
  const reset = await fetch(`${BASE}/challenge/7/reset-password/375afe1104f4a487a73823c50a9292a2`, {
    headers: { Cookie: cookies.cookieHeader },
  });
  const body = await reset.text();
  const flag = UUID.exec(body)?.[0];
  assert.ok(!flag, 'patched: the guessable reset-password link must not leak a flag');
  // The /challenge/7 send-link assignment must also not be solvable by the exploit.
  const send = await wgFetch('/challenge/7', {
    cookies, method: 'POST', body: new URLSearchParams({ email: 'admin@webgoat-cloud.org' }),
  });
  assertAttackResult(send);
  assert.ok(!lessonCompleted(send), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-81-JWT-Voting-Challenge', async () => {
  // VERB-based auth bypass: GET is rejected and only GET is mapped — send HEAD, which Spring
  // routes to the GET handler but request.getMethod() != "GET", so the flag header is returned.
  // Anti-vacuous: a HEAD response carries no body to inspect, so the absence of
  // the flag header proves nothing unless the challenge is actually being served.
  // Its lesson overview is a real, non-empty array on the live app (#107).
  assertLessonOverview(await wgFetch('/service/lessonoverview.mvc/Challenge8', { cookies }), 'challenge 8 overview');

  const vote = await fetch(`${BASE}/challenge/8/vote/5`, {
    method: 'HEAD', headers: { Cookie: cookies.cookieHeader },
  });
  const header = vote.headers.get('x-flagcontroller') ?? '';
  const flag = UUID.exec(header)?.[0];
  assert.ok(!flag, 'patched: the HEAD verb-bypass must not leak a flag header');
});
