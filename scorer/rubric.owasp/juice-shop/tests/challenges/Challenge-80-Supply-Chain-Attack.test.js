import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

test('Challenge 13 — Supply Chain Attack: B2B orders must not evaluate orderLinesData as code', async () => {
  const token = await registerAndLogin({
    email: `ctf-c13-${Date.now()}@local.test`,
    password: 'CtfTester!23',
  });

  // Before the patch, an infinite loop payload would trigger the rceChallenge.
  // After the patch, the endpoint ignores orderLinesData entirely and returns a normal order.
  const res = await api('/b2b/v2/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      orderLinesData: 'while(true){}',
      cid: 'test-cid',
    }),
  });

  // Must return 200 with a normal order response (code was not executed)
  assert.equal(res.status, 200, `Expected 200 from B2B endpoint, got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.ok(res.body?.orderNo, 'Response should include orderNo (order processed normally)');
  assert.ok(res.body?.paymentDue, 'Response should include paymentDue');
});

test('Challenge 13 — Supply Chain Attack: infinite-loop payload must not cause 503 timeout', async () => {
  const token = await registerAndLogin({
    email: `ctf-c13b-${Date.now()}@local.test`,
    password: 'CtfTester!23',
  });

  const start = Date.now();
  const res = await api('/b2b/v2/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      orderLinesData: 'while(true){}',
      cid: 'timeout-test',
    }),
  });
  const elapsed = Date.now() - start;

  // Before patch, this would take ~2s (vm timeout) and return 503
  // After patch, it returns immediately with 200
  assert.ok(elapsed < 1800, `Order took ${elapsed}ms — may still be evaluating code (expected < 1800ms)`);
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
});
