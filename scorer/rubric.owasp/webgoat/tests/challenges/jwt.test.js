/**
 * JWT — A07:2025 Authentication Failures. Pass-on-patch.
 *
 * alg:none, HS256 weak-secret forgery, votes admin-claim forgery, kid SQLi, jku injection.
 * Exploit request bytes are unchanged; each exploit subtest passes only when the attack is BLOCKED.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted, WEBWOLF } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const jb64u = (obj) => b64u(JSON.stringify(obj));
const hmac = (alg, key, data) => crypto.createHmac(alg, key).update(data).digest();

function signHS(header, payload, keyBytes, nodeAlg) {
  const si = `${jb64u(header)}.${jb64u(payload)}`;
  return `${si}.${b64u(hmac(nodeAlg, keyBytes, si))}`;
}



await test('Challenge-54-JWT-Secret-Cracking', async () => {
  // Brute the HS256 secret (base64 of one of 5 dictionary words), then forge username=WebGoat.
  const tok = (await wgFetch('/JWT/secret/gettoken', { cookies })).text.trim();
  const [h, p, s] = tok.split('.');
  const si = Buffer.from(`${h}.${p}`, 'utf8');
  const sig = Buffer.from(s, 'base64url');
  const SECRETS = ['victory', 'business', 'available', 'shipping', 'washington'];
  const key = SECRETS.find((w) => hmac('sha256', Buffer.from(w), si).equals(sig));
  assert.ok(key, 'could not crack JWT secret');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  payload.username = 'WebGoat';
  const forged = signHS({ alg: 'HS256' }, payload, Buffer.from(key), 'sha256');
  const res = await wgFetch('/JWT/secret', { cookies, method: 'POST', body: new URLSearchParams({ token: forged }) });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-55-JWT-Algorithm-Bypass', async () => {
  // JWT_PASSWORD = base64('victory'); jjwt's HMAC key bytes are 'victory'. Forge admin=true.
  const payload = { iat: Math.floor(Date.now() / 1000) + 100000, admin: 'true', user: 'Tom' };
  const token = signHS({ alg: 'HS512' }, payload, Buffer.from('victory'), 'sha512');
  const res = await wgFetch('/JWT/votings', {
    cookies, method: 'POST',
    headers: { Cookie: `JSESSIONID=${cookies.jsessionid}; access_token=${token}` },
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-56-JWT-Refresh-Token', async () => {
  // alg:none with no signature, user=Tom.
  const token = `${jb64u({ alg: 'none' })}.${jb64u({ admin: 'false', user: 'Tom' })}.`;
  const res = await wgFetch('/JWT/refresh/checkout', {
    cookies, method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-58-JWT-KID-Injection', async () => {
  // The kid header is concatenated into a SQL query, but using the known DB key id 'webgoat_key'
  // is sufficient: the stored value is decoded as base64 to form the HMAC key.
  const key = Buffer.from('qwertyqwerty1234', 'base64'); // TextCodec.BASE64.decode of the DB value
  const token = signHS({ alg: 'HS256', kid: 'webgoat_key' }, { username: 'Tom' }, key, 'sha256');
  const res = await wgFetch('/JWT/kid/delete', { cookies, method: 'POST', body: new URLSearchParams({ token }) });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-57-JWT-JKU-Injection', async () => {
  // Host a JWKS on WebWolf, reference it via the jku header, sign with our RSA key, username=Tom.
  // Requires WebWolf reachable at WEBWOLF; the WebGoat server fetches our JWKS server-to-server.
  // Login to WebWolf (WEBWOLFSESSION cookie) and upload the JWKS.
  const wwLogin = await fetch(`${WEBWOLF}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=webgoat&password=webgoat',
  });
  let ws = null;
  const sc = typeof wwLogin.headers.getSetCookie === 'function' ? wwLogin.headers.getSetCookie() : [];
  for (const c of sc) if (c.startsWith('WEBWOLFSESSION=')) ws = c.split(';')[0].split('=')[1];
  assert.ok(ws, 'WebWolf login failed (is WebWolf running on :9090?)');

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'webwolf-jku-key';
  const jwks = JSON.stringify({ keys: [{ kty: 'RSA', kid, use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e }] });

  const form = new FormData();
  form.append('file', new Blob([jwks]), 'jwks.json');
  await fetch(`${WEBWOLF}/fileupload`, { method: 'POST', headers: { Cookie: `WEBWOLFSESSION=${ws}` }, body: form, redirect: 'manual' });
  const jku = `http://127.0.0.1:9090/WebWolf/files/webgoat/jwks.json`;

  const header = { alg: 'RS256', typ: 'JWT', kid, jku };
  const payload = { username: 'Tom', admin: 'true' };
  const si = `${jb64u(header)}.${jb64u(payload)}`;
  const sig = b64u(crypto.sign('sha256', Buffer.from(si), privateKey));
  const token = `${si}.${sig}`;
  const res = await wgFetch('/JWT/jku/delete', { cookies, method: 'POST', body: new URLSearchParams({ token }) });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
