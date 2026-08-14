import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

const IFRAME = '<iframe src="javascript:alert(`xss`)">';

// Registering a user whose email contains an XSS payload must not persist the raw
// payload — the email setter must sanitize it.
test('persistedXssUserChallenge — user email must be sanitized on registration', async () => {
  const reg = await api('/api/Users', {
    method: 'POST',
    body: JSON.stringify({ email: `pre${Date.now()}${IFRAME}`, password: 'CtfTester!23', passwordRepeat: 'CtfTester!23', securityQuestion: null, securityAnswer: 'x' }),
  });
  const email = reg.body?.data?.email ?? '';
  assert.ok(!email.includes(IFRAME), `stored email must not contain the iframe payload, got: ${email}`);
});
