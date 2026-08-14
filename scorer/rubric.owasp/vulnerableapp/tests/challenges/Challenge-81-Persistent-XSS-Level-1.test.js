import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// stored XSS persists and renders unencoded

test('Challenge-81-Persistent-XSS-Level-1', async () => {
  const pay = "<script>alert(PXSS84)</script>";
  await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_1', { params: { comment: pay } });
  const res = await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_1');
  assert.ok(!res.text.includes(pay), 'stored payload reflected unencoded — persistent XSS not blocked');
});
