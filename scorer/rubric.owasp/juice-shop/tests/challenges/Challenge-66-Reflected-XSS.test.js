import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForServer, api, assertShopAlive } from '../helpers.js';

await waitForServer();

const BASE = process.env.JUICE_SHOP_URL ?? 'http://localhost:3000';

const PAYLOAD = '<iframe src="javascript:alert(`xss`)">';

// The track-order id is reflected in the response and must be stripped of non-word
// characters so an XSS payload can never be reflected back to the client.
//
// NOTE: assert against the RAW response text, not JSON.stringify(body). JSON.stringify
// escapes the payload's double-quotes (src="…" -> src=\"…\"), so a needle containing raw
// quotes never matches even when the iframe IS reflected — the old test passed unconditionally
// for that reason. The unescaped HTML markers (`<iframe`, `javascript:`) survive JSON
// serialization untouched, so we look for those in the raw body instead.
test('reflectedXssChallenge — track-order id must be stripped of HTML', async () => {
  // Anti-vacuous: the shop must actually be serving before any "blocked"
  // assertion below can mean anything (docs/scorer.md, #47).
  await assertShopAlive();

  const res = await fetch(`${BASE}/rest/track-order/${encodeURIComponent(PAYLOAD)}`);
  const raw = await res.text();

  assert.ok(
    !raw.includes('<iframe'),
    `reflected order id still contains an HTML <iframe> tag — strip non-word characters from ` +
    `the id in routes/trackOrder.ts. Response: ${raw.slice(0, 300)}`
  );
  assert.ok(
    !/javascript:/i.test(raw),
    `reflected order id still contains a javascript: URI scheme. Response: ${raw.slice(0, 300)}`
  );
});
