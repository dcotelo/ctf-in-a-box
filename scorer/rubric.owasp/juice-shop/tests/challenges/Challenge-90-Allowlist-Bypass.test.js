import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

test('redirectChallenge — open redirect via appended allow-listed URL must be rejected', async () => {
  const res = await api('/redirect?to=https://evil.example.com?to=https://github.com/juice-shop/juice-shop', { redirect: 'manual' });
  assert.ok(
    res.status >= 400,
    `open-redirect smuggling should be rejected, got ${res.status}`
  );
});

test('redirectChallenge — a genuinely allow-listed URL still redirects', async () => {
  const res = await api('/redirect?to=https://github.com/juice-shop/juice-shop', { redirect: 'manual' });
  assert.ok(
    res.status >= 300 && res.status < 400,
    `allow-listed redirect should still work, got ${res.status}`
  );
});
