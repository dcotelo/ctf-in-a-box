import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// XSS via backtick payload bypassing parenthesis filter

test('Challenge-107-XSS-Img-Attr-Level-4', async () => {
  const res = await vaFetch('/XSSInImgTagAttribute/LEVEL_4', { params: { src: 'x onerror=alert`1`' } });
  assert.doesNotMatch(res.text, /onerror=alert`1`/, 'XSS payload must be sanitized/escaped by the patch');
});
