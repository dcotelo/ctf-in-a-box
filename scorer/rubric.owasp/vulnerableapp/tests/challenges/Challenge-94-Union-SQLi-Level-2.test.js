import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// UNION-based SQLi exfiltrates row data

test('Challenge-94-Union-SQLi-Level-2', async () => {
  const res = await vaFetch('/UnionBasedSQLInjectionVulnerability/LEVEL_2', { params: { id: "5' UNION SELECT * FROM cars WHERE id='1" } });
  assert.doesNotMatch(res.text, /Audi/, 'UNION-injected row data must not be exfiltrated after patch');
});
