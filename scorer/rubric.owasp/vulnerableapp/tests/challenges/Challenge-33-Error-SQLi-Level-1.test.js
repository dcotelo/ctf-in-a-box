import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// error-based SQLi leaks DB error / query

test('Challenge-33-Error-SQLi-Level-1', async () => {
  const res = await vaFetch('/ErrorBasedSQLInjectionVulnerability/LEVEL_1', { params: { id: "1 OR id=#" } });
  // Database error message / SQL statement must NOT leak into the response once patched.
  assert.doesNotMatch(res.text, /(JdbcSQL|SQL statement|bad SQL grammar|conversion error|moreInfo)/i, 'patched: raw DB error / SQL statement must not leak');
});
