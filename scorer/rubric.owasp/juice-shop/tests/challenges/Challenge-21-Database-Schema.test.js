import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

// The product search must not allow reading the SQLite schema via UNION injection.
test('dbSchemaChallenge — schema must not be extractable via search injection', async () => {
  const q = "qwert')) UNION SELECT sql, '2','3','4','5','6','7','8','9' FROM sqlite_master--";
  const res = await api(`/rest/products/search?q=${encodeURIComponent(q)}`);
  const body = JSON.stringify(res.body ?? '');
  assert.ok(!body.includes('CREATE TABLE'), 'database schema must not be returned by product search');
});
