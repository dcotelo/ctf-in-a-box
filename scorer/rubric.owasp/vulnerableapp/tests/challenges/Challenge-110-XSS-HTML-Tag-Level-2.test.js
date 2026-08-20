import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// reflected XSS, payload reflected unencoded

test('Challenge-110-XSS-HTML-Tag-Level-2', async () => {
  const res = await vaFetch('/XSSWithHtmlTagInjection/LEVEL_2', { params: { name: "<body onload=alert(1)>" } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-110-xss-html-tag-level-2');
  assert.ok(!res.text.includes("<body onload=alert(1)>"), 'XSS payload reflected unencoded — patch must encode/strip it');
});
