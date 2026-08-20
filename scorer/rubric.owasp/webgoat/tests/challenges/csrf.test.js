/**
 * CSRF — A01:2025 Broken Access Control (cross-site state-changing requests). Pass-on-patch:
 * each subtest sends the IDENTICAL exploit bytes and PASSES only when the exploit is BLOCKED
 * (lesson NOT solved / flag ABSENT). On the stock vulnerable app these subtests FAIL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted, BASE , assertAttackResult } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

await test('Challenge-38-CSRF-Review', async () => {
  // Forged review from a cross-origin Referer with the leaked weak anti-CSRF token.
  const res = await wgFetch('/csrf/review', {
    cookies, method: 'POST',
    headers: { Referer: 'http://evil.attacker.com/csrf.html' },
    body: new URLSearchParams({ reviewText: 'great', stars: '5', validateReq: '2aa14227b9a13d0bede0388a7fba9aa9' }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-40-CSRF-Flag', async () => {
  // basic-get-flag (no Referer) stores a flag in the session; confirm it.
  const flagRes = await wgFetch('/csrf/basic-get-flag', {
    cookies, method: 'POST', body: new URLSearchParams({ csrf: 'true' }),
  });
  const flag = flagRes.json?.flag;
  // patched: the basic-get CSRF flag endpoint must not hand out a flag to a forged request.
  assert.ok(flag == null, `patched: no CSRF flag should be issued, got: ${flagRes.text.slice(0, 200)}`);
  const res = await wgFetch('/csrf/confirm-flag-1', {
    cookies, method: 'POST', body: new URLSearchParams({ confirmFlagVal: String(flag) }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-39-CSRF-Feedback', async () => {
  // Cross-host text/plain POST returns a flag in the feedback message; then confirm it.
  const msg = await wgFetch('/csrf/feedback/message', {
    cookies, method: 'POST',
    headers: { 'Content-Type': 'text/plain', Referer: 'http://evil.attacker.com/' },
    body: JSON.stringify({ name: 'a', email: 'a@a.io', subject: 's', message: 'm' }),
  });
  const m = /flag is: ([0-9a-f-]+)/.exec(msg.json?.feedback ?? '');
  // patched: a cross-host text/plain POST must not be served a flag in the feedback message.
  assert.ok(!m, `patched: no feedback flag should be issued, got: ${msg.text.slice(0, 200)}`);
  const res = await wgFetch('/csrf/feedback', {
    cookies, method: 'POST', body: new URLSearchParams({ confirmFlagVal: m ? m[1] : '' }),
  });
  assertAttackResult(res);
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-37-CSRF-Login', async () => {
  // CSRF login attack: register a csrf-prefixed account; when it logs in and hits /csrf/login,
  // progress is credited (the tracker maps csrf-<x> back to <x>).
  const uname = 'csrf-webgoat';
  const reg = await fetch(`${BASE}/register.mvc`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: uname, password: 'webgoat', matchingPassword: 'webgoat', agree: 'agree' }).toString(),
  });
  let sid = null;
  const sc = typeof reg.headers.getSetCookie === 'function' ? reg.headers.getSetCookie() : [];
  for (const c of sc) if (c.startsWith('JSESSIONID=')) sid = c.split(';')[0].split('=')[1];
  // If the user already exists, log in instead.
  if (!sid) {
    const login = await fetch(`${BASE}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=${uname}&password=webgoat`,
    });
    const sc2 = typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : [];
    for (const c of sc2) if (c.startsWith('JSESSIONID=')) sid = c.split(';')[0].split('=')[1];
  }
  assert.ok(sid, 'could not establish a csrf- user session');
  const res = await fetch(`${BASE}/csrf/login`, {
    method: 'POST', headers: { Cookie: `JSESSIONID=${sid}` }, redirect: 'manual',
  });
  const body = await res.text();
  // Anti-vacuous: `JSON.parse(body).lessonCompleted !== true` is satisfied by any
  // body without the field at all — including `{}` (#107).
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  if (res.status !== 200 || !parsed || typeof parsed.lessonCompleted !== 'boolean') {
    throw new Error(
      `anti-vacuous precondition failed: /csrf/login returned ${res.status} with no ` +
      `AttackResult envelope (${body.slice(0, 120)}).`,
    );
  }
  assert.ok(parsed.lessonCompleted !== true, `patched: the exploit must not solve the lesson: ${body.slice(0, 200)}`);
});
