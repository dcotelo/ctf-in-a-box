import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// XSS via unquoted img src attribute

test('Challenge-104-XSS-Img-Attr-Level-1', async () => {
  const res = await vaFetch('/XSSInImgTagAttribute/LEVEL_1', { params: { src: 'x onerror=alert(1)' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-104-xss-img-attr-level-1');
  assert.doesNotMatch(res.text, /<img src=x onerror=alert\(1\)/, 'XSS payload must be sanitized/escaped by the patch');
});
