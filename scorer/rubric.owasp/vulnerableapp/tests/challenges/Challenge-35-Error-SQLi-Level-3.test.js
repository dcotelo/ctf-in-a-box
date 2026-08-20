import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// error-based SQLi leaks DB error / query

test('Challenge-35-Error-SQLi-Level-3', async () => {
  const res = await vaFetch('/ErrorBasedSQLInjectionVulnerability/LEVEL_3', { params: { id: "#" } });
  // Database error message / SQL statement must NOT leak into the response once patched.
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-35-error-sqli-level-3');
  assert.doesNotMatch(res.text, /(JdbcSQL|SQL statement|bad SQL grammar|conversion error|moreInfo)/i, 'patched: raw DB error / SQL statement must not leak');
});
