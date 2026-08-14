import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// no framing protection header (frameable)

test('Challenge-16-Clickjacking-Level-6', async () => {
  const res = await vaFetch('/ClickjackingVulnerability/LEVEL_6');
  const xfo = res.headers.get('x-frame-options');
  const csp = res.headers.get('content-security-policy') || '';
  assert.ok(xfo != null || /frame-ancestors/.test(csp), 'no framing protection — patch must set X-Frame-Options or CSP frame-ancestors');
});
