import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

// A single PATCH must never update more than one review, and NoSQL query operators
// supplied as the id must be rejected rather than matching every document.
test('noSqlReviewsChallenge — operator-based id must be rejected', async () => {
  const token = await registerAndLogin({ email: `ctf-nosqlr-${Date.now()}@local.test`, password: 'CtfTester!23' });
  const res = await api('/rest/products/reviews', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: { $ne: -1 }, message: 'mass update attempt' }),
  });
  // Either rejected outright, or modified at most one document — never many.
  if (res.status >= 200 && res.status < 300) {
    const modified = res.body?.modified ?? 0;
    assert.ok(modified <= 1, `multi-document NoSQL update must be prevented, modified=${modified}`);
  } else {
    assert.ok(res.status >= 400, `operator id should be rejected, got ${res.status}`);
  }
});
