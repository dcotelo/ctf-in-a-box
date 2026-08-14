/**
 * General lessons: CIA quiz, ChromeDevTools, ClientSideFiltering, BypassRestrictions,
 * InsecureLogin, SecurePasswords, HtmlTampering. Pass-on-patch: each subtest passes
 * only when the exploit is BLOCKED (lesson NOT solved).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

await test('Challenge-7-HTML-Tampering', async () => {
  // Tamper the hidden Total field below QTY * unit price.
  const res = await wgFetch('/HtmlTampering/task', {
    cookies, method: 'POST', body: new URLSearchParams({ QTY: '1', Total: '0' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-9-Hidden-Data-Exposure', async () => {
  const res = await wgFetch('/clientSideFiltering/getItForFree', {
    cookies, method: 'POST', body: new URLSearchParams({ checkoutCode: 'get_it_for_free' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-11-Frontend-Validation-Bypass', async () => {
  // Bypass JS validation: send values that violate every field's regex, error=0.
  const res = await wgFetch('/BypassRestrictions/frontendValidation', {
    cookies, method: 'POST',
    body: new URLSearchParams({
      field1: 'aaaa', field2: '1', field3: '!!!', field4: 'ten',
      field5: '1', field6: '1', field7: '1', error: '0',
    }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-10-Field-Restriction-Bypass', async () => {
  const res = await wgFetch('/BypassRestrictions/FieldRestrictions', {
    cookies, method: 'POST',
    body: new URLSearchParams({
      select: 'option3', radio: 'option3', checkbox: 'maybe',
      shortInput: 'thisIsAVeryLongInputString', readOnlyInput: 'hacked',
    }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-12-Insecure-Login', async () => {
  // Credentials sniffed from plaintext traffic.
  const res = await wgFetch('/InsecureLogin/task', {
    cookies, method: 'POST',
    body: new URLSearchParams({ username: 'CaptainJack', password: 'BlackPearl' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

