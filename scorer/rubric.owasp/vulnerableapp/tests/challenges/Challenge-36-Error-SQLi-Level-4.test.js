import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// error-based SQLi leaks DB error / query

test('Challenge-36-Error-SQLi-Level-4', async () => {
  const res = await vaFetch('/ErrorBasedSQLInjectionVulnerability/LEVEL_4', { params: { id: "#" } });
  // Database error message / SQL statement must NOT leak into the response once patched.
  assert.doesNotMatch(res.text, /(JdbcSQL|SQL statement|bad SQL grammar|conversion error|moreInfo)/i, 'patched: raw DB error / SQL statement must not leak');
});
