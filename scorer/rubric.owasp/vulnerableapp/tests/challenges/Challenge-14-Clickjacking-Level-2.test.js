import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// permissive X-Frame-Options: ALLOWALL

test('Challenge-14-Clickjacking-Level-2', async () => {
  const res = await vaFetch('/ClickjackingVulnerability/LEVEL_2');
  assert.notEqual((res.headers.get('x-frame-options') || '').toUpperCase(), 'ALLOWALL', 'permissive X-Frame-Options: ALLOWALL — patch must set DENY/SAMEORIGIN');
});
