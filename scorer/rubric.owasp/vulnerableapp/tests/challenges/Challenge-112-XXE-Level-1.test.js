import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// XXE external entity reads local file

test('Challenge-112-XXE-Level-1', async () => {
  const xml = "<?xml version=\"1.0\"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM \"file:///etc/hostname\">]><book><name>&xxe;</name><isbn>1</isbn><author>a</author><publisher>p</publisher><others>o</others></book>";
  const res = await vaFetch('/XXEVulnerability/LEVEL_1', { method: 'POST', body: xml, headers: { 'Content-Type': 'text/xml' } });
  // The container hostname read from /etc/hostname is reflected into the parsed name field.
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-112-xxe-level-1');
  assert.notEqual(res.json?.isValid, true, 'XXE external entity resolved — patch must disable external entities');
  assert.ok(!(res.json?.content && typeof res.json.content.name === 'string' && res.json.content.name.trim().length > 0), 'leaked file content reflected into name — patch must not resolve &xxe;');
});
