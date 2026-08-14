import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

test('Challenge 10 — Mint the Honey Pot: /rest/web3/nftMintListen must require authentication', async () => {
  const res = await api('/rest/web3/nftMintListen');
  assert.ok(
    [401, 403].includes(res.status),
    `/rest/web3/nftMintListen should return 401 without auth, got ${res.status}`
  );
});

test('Challenge 10 — Mint the Honey Pot: /rest/web3/walletNFTVerify must require authentication', async () => {
  const res = await api('/rest/web3/walletNFTVerify', {
    method: 'POST',
    body: JSON.stringify({ walletAddress: '0xdeadbeef' }),
  });

  assert.ok(
    [401, 403].includes(res.status),
    `/rest/web3/walletNFTVerify should return 401 without auth, got ${res.status}`
  );
});
