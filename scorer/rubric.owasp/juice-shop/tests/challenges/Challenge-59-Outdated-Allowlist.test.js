import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer } from '../helpers.js';

await waitForServer();

// The deprecated crypto-donation addresses must no longer be reachable via the redirector.
const deprecated = [
  'https://explorer.dash.org/address/Xr556RzuwX6hg5EGpkybbv5RanJoZN17kW',
  'https://blockchain.info/address/1AbKfgvw9psQ41NbLi8kufDQTezwG8DRZm',
  'https://etherscan.io/address/0x0f933ab9fcaaa782d0279c300d73750e1311eae6',
];

for (const url of deprecated) {
  test(`redirectCryptoCurrencyChallenge — deprecated address rejected: ${url}`, async () => {
    const res = await api(`/redirect?to=${encodeURIComponent(url)}`, { redirect: 'manual' });
    assert.ok(res.status >= 400, `deprecated crypto redirect should be rejected, got ${res.status}`);
  });
}
