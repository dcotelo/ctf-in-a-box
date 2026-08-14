import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// stored XSS via svg payload bypasses tag filter

test('Challenge-84-Persistent-XSS-Level-4', async () => {
  const pay = "<svg onload=alert(PXSS87)>";
  await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_4', { params: { comment: pay } });
  const res = await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_4');
  assert.ok(!res.text.includes(pay), 'stored payload reflected unencoded — persistent XSS not blocked');
});
