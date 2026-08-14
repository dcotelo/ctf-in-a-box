import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// XSS via event handler in unquoted escaped img src

test('Challenge-106-XSS-Img-Attr-Level-3', async () => {
  const res = await vaFetch('/XSSInImgTagAttribute/LEVEL_3', { params: { src: 'x onerror=alert(1)' } });
  assert.doesNotMatch(res.text, /<img src=x onerror=alert\(1\)/, 'XSS payload must be sanitized/escaped by the patch');
});
