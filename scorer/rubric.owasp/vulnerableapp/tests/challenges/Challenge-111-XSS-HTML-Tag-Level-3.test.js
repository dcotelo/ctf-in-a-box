import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// reflected XSS, payload reflected unencoded

test('Challenge-111-XSS-HTML-Tag-Level-3', async () => {
  const res = await vaFetch('/XSSWithHtmlTagInjection/LEVEL_3', { params: { name: "<body onload=confirm(1)>" } });
  assert.ok(!res.text.includes("<body onload=confirm(1)>"), 'XSS payload reflected unencoded — patch must encode/strip it');
});
