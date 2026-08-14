import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAndLogin, waitForServer } from '../helpers.js';

await waitForServer();

const BASE = process.env.JUICE_SHOP_URL ?? 'http://localhost:3000';

// The XXE-DoS fix disables entity processing in the XML parser (noent:false, dtdload:false),
// which blocks BOTH file disclosure and entity-expansion / external-fetch DoS. The previous
// test inferred "patched" from response latency (< 1900ms) using a file:///dev/random entity,
// assuming it blocks the parser — but /dev/random is non-blocking in containers, so the request
// always returned fast and the test passed whether or not entities resolved.
//
// Instead, probe entity expansion directly and assert it does NOT happen. The sentinel
// "DEADBEEF" never appears literally in the payload — it only materialises if the parser
// substitutes the &p1;/&p2; entities. So its presence in the echoed response is a reliable,
// timing-free signal that entity processing is still enabled (vulnerable).
test('xxeDosChallenge — XML entity expansion must be disabled', async () => {
  const token = await registerAndLogin({ email: `ctf-xxed-${Date.now()}@local.test`, password: 'CtfTester!23' });

  // Two internal entities concatenated in the element content. With entity processing the
  // content resolves to the contiguous token "DEADBEEF"; with it disabled the references stay
  // literal (or error). The token never appears contiguously in the source (the declarations
  // hold "DEAD" and "BEEF" separately), so its presence in the echoed body means expansion
  // happened. Single-level on purpose — libxml2's billion-laughs guard rejects NESTED entities
  // ("entity reference loop") even when vulnerable, which would mask the signal.
  const payload = `<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY p1 "DEAD">
  <!ENTITY p2 "BEEF">
]>
<foo>&p1;&p2;</foo>`;

  const fd = new FormData();
  fd.append('file', new Blob([payload], { type: 'application/xml' }), 'dos.xml');
  const res = await fetch(`${BASE}/file-upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  const body = await res.text();

  assert.ok(
    !body.includes('DEADBEEF'),
    `XML entity expansion occurred (parser substituted internal entities) — disable entity ` +
    `processing in routes/fileUpload.ts (parse with noent:false, dtdload:false, nonet:true). ` +
    `Response: ${body.slice(0, 300)}`
  );
});
