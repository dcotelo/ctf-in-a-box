import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

// The track-order lookup must use a structured equality query, not a $where JS
// predicate, so a NoSQL injection ("' || true || '") cannot return every order.
test('noSqlOrdersChallenge — track-order must not allow $where predicate injection', async () => {
  const res = await api(`/rest/track-order/${encodeURIComponent("' || 'a'=='a")}`);
  const data = res.body?.data ?? [];
  // A benign/echo response (<=1 row, no real orders) is fine; many real orders is the exploit.
  const realOrders = data.filter((o) => o && o.email !== undefined);
  assert.ok(realOrders.length <= 1, `injection must not return multiple real orders, got ${realOrders.length}`);
});
