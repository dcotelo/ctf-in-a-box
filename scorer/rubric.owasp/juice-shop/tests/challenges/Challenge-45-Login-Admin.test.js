import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, waitForServer, assertShopAlive } from '../helpers.js';

await waitForServer();

// SQL injection in the login email must not authenticate any user.
const payloads = ["' OR 1=1--", "' OR '1'='1", "admin@juice-sh.op'--"];
for (const email of payloads) {
  test(`loginAdminChallenge — SQLi login bypass rejected: ${email}`, async () => {
    // Anti-vacuous: "not a 200" is exactly what a dead app returns, so the
    // shop has to be serving before a refusal can mean the SQLi was blocked
    // (docs/scorer.md, #47).
    await assertShopAlive();

    const res = await api('/rest/user/login', { method: 'POST', body: JSON.stringify({ email, password: 'x' }) });
    assert.notEqual(res.status, 200, `SQLi login must not succeed for ${email}`);
    assert.ok(!res.body?.authentication?.token, 'no auth token should be issued for an injection payload');
  });
}
