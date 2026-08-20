import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// reflected XSS, payload reflected unencoded

test('Challenge-111-XSS-HTML-Tag-Level-3', async () => {
  const res = await vaFetch('/XSSWithHtmlTagInjection/LEVEL_3', { params: { name: "<body onload=confirm(1)>" } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-111-xss-html-tag-level-3');
  assert.ok(!res.text.includes("<body onload=confirm(1)>"), 'XSS payload reflected unencoded — patch must encode/strip it');
});
