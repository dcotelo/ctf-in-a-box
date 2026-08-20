import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// stored XSS via null-byte HTML-escape bypass

test('Challenge-86-Persistent-XSS-Level-6', async () => {
  const res = await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_6?comment=PXSS89%00%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  // The substring after the null byte must be HTML-escaped, not rendered raw.
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-86-persistent-xss-level-6');
  assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/, 'null-byte payload rendered unencoded — persistent XSS not blocked');
});
