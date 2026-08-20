import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// XXE residual: DOCTYPE + entity processing still enabled

test('Challenge-113-XXE-Level-2', async () => {
  // External general entities are disabled, but DOCTYPE and (parameter) entities are still
  // processed — the precondition for parameter-entity OOB exfiltration. Internal entity expands.
  const xml = "<?xml version=\"1.0\"?><!DOCTYPE foo [<!ENTITY ge \"INTERNALGE\">]><book><name>&ge;</name><isbn>1</isbn><author>a</author><publisher>p</publisher><others>o</others></book>";
  const res = await vaFetch('/XXEVulnerability/LEVEL_2', { method: 'POST', body: xml, headers: { 'Content-Type': 'text/xml' } });
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-113-xxe-level-2');
  assert.notEqual(res.json?.content?.name, 'INTERNALGE', 'DOCTYPE/entity processing still enabled — patch must disable DTD/entity expansion');
});
