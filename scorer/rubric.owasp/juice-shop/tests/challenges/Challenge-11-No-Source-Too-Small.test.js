import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

test('Challenge 11 — No Source Too Small: /rest/web3/walletExploitAddress must require authentication', async () => {
  const res = await api('/rest/web3/walletExploitAddress', {
    method: 'POST',
    body: JSON.stringify({ walletAddress: '0xdeadbeef' }),
  });

  assert.ok(
    [401, 403].includes(res.status),
    `/rest/web3/walletExploitAddress should return 401 without auth, got ${res.status}`
  );
});
