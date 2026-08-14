import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// stored XSS via svg payload bypasses tag filter

test('Challenge-82-Persistent-XSS-Level-2', async () => {
  const pay = "<svg onload=alert(PXSS85)>";
  await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_2', { params: { comment: pay } });
  const res = await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_2');
  assert.ok(!res.text.includes(pay), 'stored payload reflected unencoded — persistent XSS not blocked');
});
