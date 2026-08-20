import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// XSS via backtick payload bypassing parenthesis filter

test('Challenge-107-XSS-Img-Attr-Level-4', async () => {
  const res = await vaFetch('/XSSInImgTagAttribute/LEVEL_4', { params: { src: 'x onerror=alert`1`' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-107-xss-img-attr-level-4');
  assert.doesNotMatch(res.text, /onerror=alert`1`/, 'XSS payload must be sanitized/escaped by the patch');
});
