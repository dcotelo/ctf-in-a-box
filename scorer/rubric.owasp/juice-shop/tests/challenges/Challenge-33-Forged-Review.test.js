import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

// A review must be attributed to the authenticated user — a client-supplied author
// for someone else must not be persisted.
test('forgedReviewChallenge — review author is bound to the authenticated user', async () => {
  const email = `ctf-forge-${Date.now()}@local.test`;
  const token = await registerAndLogin({ email, password: 'CtfTester!23' });

  const create = await api('/rest/products/1/reviews', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: 'forged?', author: 'admin@juice-sh.op' }),
  });
  assert.ok(create.status < 500, `review creation should not error, got ${create.status}`);

  const list = await api('/rest/products/1/reviews', { headers: { Authorization: `Bearer ${token}` } });
  const reviews = list.body?.data ?? [];
  const forged = reviews.find((r) => r.message === 'forged?' && r.author === 'admin@juice-sh.op');
  assert.equal(forged, undefined, 'a review must not be persisted under a forged author');
});
