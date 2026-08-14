/**
 * SSRF (A10:2025) and XXE (A05:2025 Injection / A02 misconfiguration). Pass-on-patch:
 * each subtest sends the IDENTICAL exploit bytes and PASSES only when the exploit is BLOCKED.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted, WEBWOLF } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

// ── SSRF ─────────────────────────────────────────────────────────────────────
await test('Challenge-52-SSRF-Basic', async () => {
  // Change the requested resource to the unexpected image (jerry.png).
  const res = await wgFetch('/SSRF/task1', {
    cookies, method: 'POST', body: new URLSearchParams({ url: 'images/jerry.png' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-53-SSRF-External', async () => {
  // Make the server fetch an external URL.
  const res = await wgFetch('/SSRF/task2', {
    cookies, method: 'POST', body: new URLSearchParams({ url: 'http://ifconfig.pro' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

// ── XXE ──────────────────────────────────────────────────────────────────────
const XXE_FILE = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<!DOCTYPE comment [<!ENTITY xxe SYSTEM "file:///">]>'
  + '<comment><text>&xxe;</text></comment>';

await test('Challenge-50-XXE-Simple', async () => {
  // Read a directory listing via an external entity; the result contains usr/etc/var.
  const res = await wgFetch('/xxe/simple', {
    cookies, method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: XXE_FILE,
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-51-XXE-Content-Type', async () => {
  // The endpoint expects JSON but parses XML when Content-Type is application/xml.
  const res = await wgFetch('/xxe/content-type', {
    cookies, method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: XXE_FILE,
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

