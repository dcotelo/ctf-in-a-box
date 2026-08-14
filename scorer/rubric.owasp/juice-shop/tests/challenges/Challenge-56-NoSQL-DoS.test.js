import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

// The product-reviews lookup must coerce the id to a number and use a structured
// equality query, so a server-side-JS sleep/DoS payload cannot be injected via $where.
test('noSqlCommandChallenge — review lookup must reject non-numeric/JS ids quickly', async () => {
  const start = Date.now();
  const res = await api(`/rest/products/${encodeURIComponent('sleep(2000)')}/reviews`);
  const elapsed = Date.now() - start;
  assert.ok(res.status >= 400 || elapsed < 1500, `JS injection must be rejected or not executed, status=${res.status} elapsed=${elapsed}ms`);
});

test('noSqlCommandChallenge — numeric product id still returns reviews', async () => {
  const res = await api('/rest/products/1/reviews');
  assert.ok(res.status >= 200 && res.status < 300, `legitimate numeric id should work, got ${res.status}`);
});
