import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// reflected XSS, payload reflected unencoded

test('Challenge-110-XSS-HTML-Tag-Level-2', async () => {
  const res = await vaFetch('/XSSWithHtmlTagInjection/LEVEL_2', { params: { name: "<body onload=alert(1)>" } });
  assert.ok(!res.text.includes("<body onload=alert(1)>"), 'XSS payload reflected unencoded — patch must encode/strip it');
});
