import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// boolean-based blind SQLi (numeric)

test('Challenge-7-Blind-SQLi-Level-1', async () => {
  const t = await vaFetch('/BlindSQLInjectionVulnerability/LEVEL_1', { params: { id: '100 OR 2=2' } });
  const f = await vaFetch('/BlindSQLInjectionVulnerability/LEVEL_1', { params: { id: '1 AND 1=2' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(t, 'challenge-7-blind-sqli-level-1');
  assert.doesNotMatch(t.text, /"isCarPresent": ?true/, 'Blind SQLi boolean injection must not be interpreted as SQL by the patch');
});
