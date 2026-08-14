import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// X-Frame-Options: SAMEORIGIN allows same-origin framing

test('Challenge-17-Clickjacking-Level-7', async () => {
  const res = await vaFetch('/ClickjackingVulnerability/LEVEL_7');
  assert.notEqual((res.headers.get('x-frame-options') || '').toUpperCase(), 'SAMEORIGIN', 'X-Frame-Options: SAMEORIGIN allows same-origin framing — patch must set DENY');
});
