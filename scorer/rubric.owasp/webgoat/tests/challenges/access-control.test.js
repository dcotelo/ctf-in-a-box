/**
 * Broken Access Control group — A01:2025.
 * IDOR, Missing Function-Level AC, SpoofCookie, HijackSession, AuthBypass. Pass-on-patch (each
 * exploit must be BLOCKED; the lesson must NOT be solved).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

// ── IDOR ─────────────────────────────────────────────────────────────────────
await test('Challenge-41-IDOR-Login', async () => {
  const res = await wgFetch('/IDOR/login', {
    cookies, method: 'POST', body: new URLSearchParams({ username: 'tom', password: 'cat' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-43-IDOR-Attribute-Discovery', async () => {
  await wgFetch('/IDOR/login', { cookies, method: 'POST', body: new URLSearchParams({ username: 'tom', password: 'cat' }) });
  await wgFetch('/IDOR/profile', { cookies });
  const res = await wgFetch('/IDOR/diff-attributes', {
    cookies, method: 'POST', body: new URLSearchParams({ attributes: 'userId,role' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-44-IDOR-View-Other-Profile', async () => {
  await wgFetch('/IDOR/login', { cookies, method: 'POST', body: new URLSearchParams({ username: 'tom', password: 'cat' }) });
  await wgFetch('/IDOR/profile', { cookies });
  // tom is 2342384; bump the id to view bill (2342388).
  const res = await wgFetch('/IDOR/profile/2342388', { cookies });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-42-IDOR-Own-Profile', async () => {
  await wgFetch('/IDOR/login', { cookies, method: 'POST', body: new URLSearchParams({ username: 'tom', password: 'cat' }) });
  await wgFetch('/IDOR/profile', { cookies });
  const res = await wgFetch('/IDOR/profile/alt-path', {
    cookies, method: 'POST', body: new URLSearchParams({ url: 'WebGoat/IDOR/profile/2342384' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-45-IDOR-Edit-Other-Profile', async () => {
  await wgFetch('/IDOR/login', { cookies, method: 'POST', body: new URLSearchParams({ username: 'tom', password: 'cat' }) });
  await wgFetch('/IDOR/profile', { cookies });
  const res = await wgFetch('/IDOR/profile/2342388', {
    cookies, method: 'PUT',
    body: { userId: '2342388', role: 0, color: 'red', size: 'large', name: 'Buffalo Bill' },
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

// ── Missing Function-Level Access Control ──────────────────────────────────────
const userHash = (password, salt, username) =>
  crypto.createHash('sha256').update(password + salt + username).digest('base64');

await test('Challenge-64-Broken-Access-Control-Hidden-Menu', async () => {
  const res = await wgFetch('/access-control/hidden-menu', {
    cookies, method: 'POST', body: new URLSearchParams({ hiddenMenu1: 'Users', hiddenMenu2: 'Config' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-65-Broken-Access-Control-User-Hash', async () => {
  // Broken AC: /access-control/users leaks Jerry's hash (PASSWORD_SALT_SIMPLE) to any user.
  const hash = userHash('doesnotreallymatter', 'DeliberatelyInsecure1234', 'Jerry');
  const res = await wgFetch('/access-control/user-hash', {
    cookies, method: 'POST', body: new URLSearchParams({ userHash: hash }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-66-Broken-Access-Control-Fix', async () => {
  // The "fixed" endpoint uses PASSWORD_SALT_ADMIN; the static salt is still predictable.
  const hash = userHash('doesnotreallymatter', 'DeliberatelyInsecure1235', 'Jerry');
  const res = await wgFetch('/access-control/user-hash-fix', {
    cookies, method: 'POST', body: new URLSearchParams({ userHash: hash }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

// ── SpoofCookie ────────────────────────────────────────────────────────────────
await test('Challenge-14-Cookie-Spoofing', async () => {
  // Log in as webgoat to obtain a spoof_auth cookie, recover the static SALT, forge tom's cookie.
  const login = await wgFetch('/SpoofCookie/login', {
    cookies, method: 'POST', body: new URLSearchParams({ username: 'webgoat', password: 'webgoat' }),
  });
  const m = /spoof_auth=([A-Za-z0-9+/=]+)/.exec(login.json?.output ?? '');
  assert.ok(m, `no cookie issued: ${login.text.slice(0, 200)}`);
  const cookie = m[1];
  // decode: base64 -> hex -> reverse -> 'webgoat' + SALT
  const hexs = Buffer.from(cookie, 'base64').toString('utf8');
  const rev = Buffer.from(hexs, 'hex').toString('utf8');
  const plain = [...rev].reverse().join('');
  const salt = plain.slice('webgoat'.length);
  const tomVal = 'tom' + salt;
  const tomEnc = [...tomVal].reverse().join('');
  const tomHex = Buffer.from(tomEnc, 'utf8').toString('hex');
  const tomCookie = Buffer.from(tomHex, 'utf8').toString('base64');
  // submit with the forged cookie (username/password params present; cookie flow takes over)
  const res = await wgFetch('/SpoofCookie/login', {
    cookies, method: 'POST',
    headers: { Cookie: `JSESSIONID=${cookies.jsessionid}; spoof_auth=${tomCookie}` },
    body: new URLSearchParams({ username: 'tom', password: 'x' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

// ── HijackSession ────────────────────────────────────────────────────────────
await test('Challenge-13-Session-Hijacking', async () => {
  // Weak session id = (incrementing long)-(epochMillis). Collect samples, find the id gaps left
  // by auto-login sessions in the server queue, then guess id-timestamp within the gap window.
  const post = async (cookie) => {
    const headers = { Cookie: `JSESSIONID=${cookies.jsessionid}${cookie ? `; hijack_cookie=${cookie}` : ''}` };
    const r = await fetch(`${process.env.WEBGOAT_URL ?? 'http://localhost:8080/WebGoat'}/HijackSession/login`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=hijack&password=hijack', redirect: 'manual',
    });
    let hc = null;
    const setck = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    for (const c of setck) if (c.startsWith('hijack_cookie=')) hc = c.split(';')[0].split('=')[1];
    const body = await r.text();
    let completed = false;
    try { completed = JSON.parse(body).lessonCompleted === true; } catch { /* */ }
    return { hc, completed };
  };
  let solved = false;
  // Auto-login sessions land in the server queue ~25% of credential logins, leaving an id gap.
  // IMPORTANT: the id is a 19-digit Java long that exceeds Number.MAX_SAFE_INTEGER, so parse it
  // as BigInt — using Number() collapses distinct ids to the same rounded value.
  for (let round = 0; round < 6 && !solved; round++) {
    const samples = [];
    for (let i = 0; i < 40; i++) {
      // eslint-disable-next-line no-await-in-loop
      const { hc, completed } = await post(null);
      if (completed) { solved = true; break; }
      if (hc) { const [id, ts] = hc.split('-'); samples.push([BigInt(id), Number(ts)]); }
    }
    if (solved) break;
    samples.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const gaps = [];
    for (let i = 1; i < samples.length; i++) {
      const [pid, pts] = samples[i - 1];
      const [cid, cts] = samples[i];
      for (let mid = pid + 1n; mid < cid; mid++) gaps.push([mid, pts - 5, cts + 5]);
    }
    for (const [mid, lo, hi] of gaps) {
      if (solved) break;
      for (let ts = lo; ts <= hi && !solved; ts++) {
        // eslint-disable-next-line no-await-in-loop
        const { completed } = await post(`${mid}-${ts}`);
        if (completed) solved = true;
      }
    }
  }
  assert.ok(!solved, 'patched: the exploit must not solve the lesson');
});

// ── AuthBypass ─────────────────────────────────────────────────────────────────
await test('Challenge-15-Authorization-Bypass', async () => {
  // verifyAccount only validates secQuestion keys that ARE present and checks size==2; submit two
  // unrelated keys (secQuestion2/3) so neither real answer is verified yet the size check passes.
  const res = await wgFetch('/auth-bypass/verify-account?userId=1223445&verifyMethod=SEC_QUESTIONS', {
    cookies, method: 'POST', body: new URLSearchParams({ secQuestion2: 'any', secQuestion3: 'any' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
