import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVAmPI, vampiFetch, getToken, createDb } from '../helpers.js';

await createDb();
await waitForVAmPI();

// Pass-on-patch: drives the exploit (a catastrophic-backtracking email payload) and asserts ReDoS is
// BLOCKED. On the vulnerable app the malicious payload is dramatically slower (exponential blowup),
// so this FAILS; once the regex is fixed/bounded the payload is handled in ~benign time -> PASSES.
await test('Challenge-8-Regex-DoS', async () => {
  const token = await getToken('name1', 'pass1');

  const timeBenign = async () => {
    const t0 = Date.now();
    await vampiFetch('/users/v1/name1/email', { method: 'PUT', token, body: { email: 'valid@test.com' } });
    return Date.now() - t0;
  };
  const benignMs = Math.min(await timeBenign(), await timeBenign());

  const evil = 'a'.repeat(25) + '!';
  const evilStart = Date.now();
  await vampiFetch('/users/v1/name1/email', { method: 'PUT', token, body: { email: evil } });
  const evilMs = Date.now() - evilStart;

  // VULNERABLE: the malicious payload triggers exponential backtracking (slow). PATCHED: ~benign.
  const blewUp = evilMs > 200 && evilMs > benignMs * 3;
  assert.ok(!blewUp,
    `ReDoS must be blocked: malicious email payload must not blow up (evil=${evilMs}ms, benign=${benignMs}ms)`);
});
