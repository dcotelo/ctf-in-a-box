import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// stored XSS via svg payload bypasses tag filter

test('Challenge-83-Persistent-XSS-Level-3', async () => {
  const pay = "<svg onload=alert(PXSS86)>";
  await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_3', { params: { comment: pay } });
  const res = await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_3');
  assert.ok(!res.text.includes(pay), 'stored payload reflected unencoded — persistent XSS not blocked');
});
