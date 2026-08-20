import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// stored XSS persists and renders unencoded

test('Challenge-81-Persistent-XSS-Level-1', async () => {
  const pay = "<script>alert(PXSS84)</script>";
  await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_1', { params: { comment: pay } });
  const res = await vaFetch('/PersistentXSSInHTMLTagVulnerability/LEVEL_1');
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-81-persistent-xss-level-1');
  assert.ok(!res.text.includes(pay), 'stored payload reflected unencoded — persistent XSS not blocked');
});
