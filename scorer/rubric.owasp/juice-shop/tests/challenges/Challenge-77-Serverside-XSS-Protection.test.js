import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

const IFRAME = '<iframe src="javascript:alert(`xss`)">';

// The sanitize-html bypass (<<script>x</script>iframe ...) must not survive into a
// stored feedback comment — the strong recursive sanitizer must remove the iframe.
test('persistedXssFeedbackChallenge — feedback comment must be sanitized', async () => {
  const token = await registerAndLogin({ email: `ctf-pxf-${Date.now()}@local.test`, password: 'CtfTester!23' });
  const cap = await api('/rest/captcha/');
  const bypass = `<<script>Foo</script>iframe src="javascript:alert(\`xss\`)">`;

  const res = await api('/api/Feedbacks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ comment: bypass, rating: 1, captchaId: cap.body.captchaId, captcha: cap.body.answer }),
  });

  const comment = res.body?.data?.comment ?? '';
  assert.ok(!comment.includes(IFRAME), `feedback comment must not contain the iframe payload, got: ${comment}`);
});
