import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// XSS breaking out of quoted img src attribute

test('Challenge-105-XSS-Img-Attr-Level-2', async () => {
  const res = await vaFetch('/XSSInImgTagAttribute/LEVEL_2', { params: { src: 'x" onerror="alert(1)' } });
  assert.doesNotMatch(res.text, /onerror="alert\(1\)"/, 'XSS payload must be sanitized/escaped by the patch');
});
