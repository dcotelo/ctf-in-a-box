import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer, assertShopAlive } from '../helpers.js';

await waitForServer();

// A UNION SELECT in the product search must not exfiltrate user credentials.
test('unionSqlInjectionChallenge — UNION SELECT in search must not leak users', async () => {
  // Anti-vacuous: the shop must actually be serving before any "blocked"
  // assertion below can mean anything (docs/scorer.md, #47).
  await assertShopAlive();

  const q = "qwert')) UNION SELECT id, email, password, '4','5','6','7','8','9' FROM Users--";
  const res = await api(`/rest/products/search?q=${encodeURIComponent(q)}`);
  const body = JSON.stringify(res.body ?? '');
  // The seeded admin password hash must never appear in search results.
  assert.ok(!/[a-f0-9]{32}/.test(body) || !body.includes('@'), 'search must not return user emails/password hashes');
  assert.ok(res.status >= 400 || !body.includes('@juice-sh.op'), 'UNION injection must not exfiltrate user emails');
});
