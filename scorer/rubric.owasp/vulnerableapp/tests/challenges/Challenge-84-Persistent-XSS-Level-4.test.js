import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// stored XSS via svg payload bypasses tag filter

test('Challenge-84-Persistent-XSS-Level-4', async () => {
  const pay = "<svg onload=alert(PXSS87)>";
  await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_4', { params: { comment: pay } });
  const res = await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_4');
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-84-persistent-xss-level-4');
  assert.ok(!res.text.includes(pay), 'stored payload reflected unencoded — persistent XSS not blocked');
});
