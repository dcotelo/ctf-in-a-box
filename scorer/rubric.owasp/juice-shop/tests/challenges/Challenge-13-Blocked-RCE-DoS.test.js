import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

// The B2B order endpoint must not interpret orderLinesData as code. A malicious
// infinite-loop / DoS payload should be accepted as inert data (or rejected),
// never executed — so the request returns promptly and never errors via a vm timeout.
test('rceChallenge — b2b orderLinesData must not be evaluated as code', async () => {
  const token = await registerAndLogin({ email: `ctf-rce-${Date.now()}@local.test`, password: 'CtfTester!23' });
  const start = Date.now();
  const res = await api('/b2b/v2/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cid: 'x', orderLinesData: '(function dos(){ while(true); })()' }),
  });
  const elapsed = Date.now() - start;
  assert.ok(res.status < 500, `RCE payload must not crash the server, got ${res.status}`);
  assert.ok(elapsed < 1900, `RCE payload must not be executed (no vm timeout), took ${elapsed}ms`);
});

test('rceOccupyChallenge — DoS payload must not occupy the event loop via vm', async () => {
  const token = await registerAndLogin({ email: `ctf-rceo-${Date.now()}@local.test`, password: 'CtfTester!23' });
  const start = Date.now();
  const res = await api('/b2b/v2/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cid: 'x', orderLinesData: '/((a+)+)+$/.test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!")' }),
  });
  const elapsed = Date.now() - start;
  assert.ok(res.status < 500, `occupy payload must not 503/500, got ${res.status}`);
  assert.ok(elapsed < 1900, `occupy payload must not run (no 2s vm timeout), took ${elapsed}ms`);
});
