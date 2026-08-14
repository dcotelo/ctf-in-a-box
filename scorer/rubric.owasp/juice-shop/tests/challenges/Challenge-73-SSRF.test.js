import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

const BASE = process.env.JUICE_SHOP_URL ?? 'http://localhost:3000';

test('ssrfChallenge — internal/loopback image URLs must be rejected', async () => {
  const token = await registerAndLogin({ email: `ctf-ssrf-${Date.now()}@local.test`, password: 'CtfTester!23' });
  const fd = new FormData();
  fd.append('imageUrl', `${BASE}/solve/challenges/server-side?key=tRy_H4rd3r_n0thIng_iS_Imp0ssibl3`);
  const res = await fetch(`${BASE}/profile/image/url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Cookie: `token=${token}` },
    body: fd,
    redirect: 'manual',
  });
  assert.ok(res.status >= 400, `SSRF to internal endpoint should be rejected, got ${res.status}`);
});

test('ssrfChallenge — private address ranges must be rejected', async () => {
  const token = await registerAndLogin({ email: `ctf-ssrf2-${Date.now()}@local.test`, password: 'CtfTester!23' });
  const fd = new FormData();
  fd.append('imageUrl', 'http://169.254.169.254/latest/meta-data/');
  const res = await fetch(`${BASE}/profile/image/url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Cookie: `token=${token}` },
    body: fd,
    redirect: 'manual',
  });
  assert.ok(res.status >= 400, `SSRF to link-local metadata should be rejected, got ${res.status}`);
});
