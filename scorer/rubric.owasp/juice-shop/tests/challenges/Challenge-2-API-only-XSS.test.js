import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

const IFRAME = '<iframe src="javascript:alert(`xss`)">';

// A stored XSS payload submitted to a product description via the REST API must be
// sanitized — it must not survive into the persisted/returned description.
test('restfulXssChallenge — product description must be sanitized', async () => {
  const token = await registerAndLogin({ email: `ctf-rxss-${Date.now()}@local.test`, password: 'CtfTester!23' });

  await api('/api/Products/9', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ description: `O-Saft ${IFRAME}` }),
  });

  const res = await api('/api/Products/9');
  const desc = res.body?.data?.description ?? '';
  assert.ok(!desc.includes(IFRAME), `iframe XSS payload must be stripped from description, got: ${desc}`);
});

// Merged from the former builtin 02-api-xss.test.js (same challenge id 2, same doc):
// unlike the test above, this also asserts on the PUT response body itself, catching a
// patch that only sanitizes on read but stores the raw payload.
test('Challenge 2 — API-only XSS: product description must be sanitized on write', async () => {
  const token = await registerAndLogin({
    email: `ctf-c02-${Date.now()}@local.test`,
    password: 'CtfTester!23',
  });

  const xssPayload = '<iframe src="javascript:alert(`xss`)">';

  // Try to update product 1 description with XSS payload
  const res = await api('/api/Products/1', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ description: xssPayload }),
  });

  // Either the endpoint is blocked (4xx) or the XSS payload is sanitized in the response
  if (res.status >= 400) {
    return; // blocked — patch works
  }

  const savedDescription = res.body?.data?.description ?? res.body?.description ?? '';
  assert.ok(
    !savedDescription.includes('<iframe'),
    `XSS payload stored unsanitized in product description: ${savedDescription}`
  );

  // Verify by re-reading the product
  const check = await api('/api/Products/1');
  const desc = check.body?.data?.description ?? check.body?.description ?? '';
  assert.ok(
    !desc.includes('<iframe'),
    `XSS payload persisted in product after sanitization patch: ${desc}`
  );
});
