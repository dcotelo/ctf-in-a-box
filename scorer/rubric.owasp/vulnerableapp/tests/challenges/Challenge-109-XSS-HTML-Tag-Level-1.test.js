import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// reflected XSS, payload reflected unencoded

test('Challenge-109-XSS-HTML-Tag-Level-1', async () => {
  const res = await vaFetch('/XSSWithHtmlTagInjection/LEVEL_1', { params: { name: "<script>alert(1)</script>" } });
  assert.ok(!res.text.includes("<script>alert(1)</script>"), 'XSS payload reflected unencoded — patch must encode/strip it');
});
