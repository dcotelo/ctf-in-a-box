import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

test('Challenge 7 — Bjoern\'s Favorite Pet: short security answers must be rejected on password reset', async () => {
  // 'Zaya' is 4 chars — below the 10-char minimum enforced by the patch
  const res = await api('/rest/user/reset-password', {
    method: 'POST',
    body: JSON.stringify({
      email: 'bjoern@owasp.org',
      answer: 'Zaya',
      new: 'NewP@ssw0rd1',
      repeat: 'NewP@ssw0rd1',
    }),
  });

  assert.ok(
    res.status === 401,
    `Short security answer 'Zaya' should be rejected with 401, got ${res.status}: ${JSON.stringify(res.body)}`
  );
});

test('Challenge 7 — Bjoern\'s Favorite Pet: password reset with adequate-length answer accepted (if correct)', async () => {
  // An answer longer than 10 chars should at least pass length validation (may fail if answer is wrong)
  const res = await api('/rest/user/reset-password', {
    method: 'POST',
    body: JSON.stringify({
      email: 'bjoern@owasp.org',
      answer: 'ThisAnswerIsLongEnough',
      new: 'NewP@ssw0rd1',
      repeat: 'NewP@ssw0rd1',
    }),
  });

  // Status 401 here means wrong answer (not length rejection), which is correct behavior
  // The important thing is it doesn't 500 — length check runs before answer check
  assert.ok(
    res.status < 500,
    `Server error on password reset: ${res.status}: ${JSON.stringify(res.body)}`
  );
});
