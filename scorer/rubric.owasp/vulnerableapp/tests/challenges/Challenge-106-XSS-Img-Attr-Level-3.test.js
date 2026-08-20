import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// XSS via event handler in unquoted escaped img src

test('Challenge-106-XSS-Img-Attr-Level-3', async () => {
  const res = await vaFetch('/XSSInImgTagAttribute/LEVEL_3', { params: { src: 'x onerror=alert(1)' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-106-xss-img-attr-level-3');
  assert.doesNotMatch(res.text, /<img src=x onerror=alert\(1\)/, 'XSS payload must be sanitized/escaped by the patch');
});
