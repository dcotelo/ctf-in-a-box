import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

const BASE = process.env.JUICE_SHOP_URL ?? 'http://localhost:3000';

// An XML upload with an external SYSTEM entity must NOT disclose local files —
// external entity substitution must be disabled.
test('xxeFileDisclosureChallenge — external entities must not be resolved', async () => {
  const token = await registerAndLogin({ email: `ctf-xxe-${Date.now()}@local.test`, password: 'CtfTester!23' });
  const xxe = `<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE foo [ <!ELEMENT foo ANY ><!ENTITY xxe SYSTEM "file:///etc/passwd" >]>
<foo>&xxe;</foo>`;
  const fd = new FormData();
  fd.append('file', new Blob([xxe], { type: 'application/xml' }), 'payload.xml');
  const res = await fetch(`${BASE}/file-upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const body = await res.text();
  assert.ok(!body.includes('root:') && !/root:.*:0:0:/.test(body), 'XXE must not disclose /etc/passwd contents');
});
