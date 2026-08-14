/**
 * Cross-Site Scripting (reflected, DOM, stored, mitigations) — A05:2025 Injection.
 * Pass-on-patch: each exploit subtest passes only when the XSS payload is BLOCKED
 * (the lesson must NOT be solved). Quiz / answer-based subtests carry no attacker
 * payload and are left as pass-when-answered controls (noted inline).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();


await test('Challenge-32-XSS-DOM-Sink', async () => {
  // Reflected XSS: inject a <script>alert()</script> into the credit-card field (field1).
  const qs = new URLSearchParams({
    QTY1: '1', QTY2: '1', QTY3: '1', QTY4: '1',
    field1: '<script>alert(1);</script>', field2: '111',
  });
  const res = await wgFetch(`/CrossSiteScripting/attack5a?${qs.toString()}`, { cookies, method: 'GET' });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
  assert.ok(!/<script>alert\(1\);<\/script>/.test(res.text), 'patched: the reflected payload must be absent/encoded');
});


await test('Challenge-34-XSS-Phone-Home', async () => {
  const res = await wgFetch('/CrossSiteScripting/phone-home-xss', {
    cookies, method: 'POST',
    headers: { 'webgoat-requested-by': 'dom-xss-vuln' },
    body: new URLSearchParams({ param1: '42', param2: '24' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-33-XSS-DOM-Followup', async () => {
  const ph = await wgFetch('/CrossSiteScripting/phone-home-xss', {
    cookies, method: 'POST',
    headers: { 'webgoat-requested-by': 'dom-xss-vuln' },
    body: new URLSearchParams({ param1: '42', param2: '24' }),
  });
  // On a patched app the DOM-XSS phone-home is blocked and may yield no randValue; fall back
  // to an empty submission so the follow-up assertion is what proves the patch holds.
  const m = /phoneHome Response is (-?\d+)/.exec(ph.json?.output ?? '');
  const res = await wgFetch('/CrossSiteScripting/dom-follow-up', {
    cookies, method: 'POST', body: new URLSearchParams({ successMessage: m ? m[1] : '' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});


await test('Challenge-35-XSS-Stored', async () => {
  const res = await wgFetch('/CrossSiteScriptingStored/stored-xss', {
    cookies, method: 'POST',
    body: { text: '<script>webgoat.customjs.phoneHome()</script>' },
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-36-XSS-Stored-Followup', async () => {
  const ph = await wgFetch('/CrossSiteScripting/phone-home-xss', {
    cookies, method: 'POST',
    headers: { 'webgoat-requested-by': 'dom-xss-vuln' },
    body: new URLSearchParams({ param1: '42', param2: '24' }),
  });
  // On a patched app the DOM-XSS phone-home is blocked and may yield no randValue; fall back
  // to an empty submission so the follow-up assertion is what proves the patch holds.
  const m = /phoneHome Response is (-?\d+)/.exec(ph.json?.output ?? '');
  const res = await wgFetch('/CrossSiteScriptingStored/stored-xss-follow-up', {
    cookies, method: 'POST', body: new URLSearchParams({ successMessage: m ? m[1] : '' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});


