import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// XSS via null-byte allowlist bypass in img src

test('Challenge-108-XSS-Img-Attr-Level-5', async () => {
  const res = await vaFetch('/XSSInImgTagAttribute/LEVEL_5?src=/VulnerableApp/images/OWASP.png%00 onerror=alert(1)');
  assert.doesNotMatch(res.text, /onerror=alert\(1\)/, 'XSS payload must be sanitized/escaped by the patch');
});
