import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// boolean-based blind SQLi (single-quote wrapped)

test('Challenge-8-Blind-SQLi-Level-2', async () => {
  const t = await vaFetch('/BlindSQLInjectionVulnerability/LEVEL_2', { params: { id: "100'OR '1'='1" } });
  const f = await vaFetch('/BlindSQLInjectionVulnerability/LEVEL_2', { params: { id: "1'AND '1'='2" } });
  assert.doesNotMatch(t.text, /"isCarPresent": ?true/, 'Blind SQLi boolean injection must not be interpreted as SQL by the patch');
});
