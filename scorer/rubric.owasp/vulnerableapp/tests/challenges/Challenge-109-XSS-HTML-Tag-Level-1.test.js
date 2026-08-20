import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// reflected XSS, payload reflected unencoded

test('Challenge-109-XSS-HTML-Tag-Level-1', async () => {
  const res = await vaFetch('/XSSWithHtmlTagInjection/LEVEL_1', { params: { name: "<script>alert(1)</script>" } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-109-xss-html-tag-level-1');
  assert.ok(!res.text.includes("<script>alert(1)</script>"), 'XSS payload reflected unencoded — patch must encode/strip it');
});
