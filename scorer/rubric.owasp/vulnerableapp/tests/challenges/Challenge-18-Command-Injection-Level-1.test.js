import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// OS command injection (id executed)

test('Challenge-18-Command-Injection-Level-1', async () => {
  const res = await vaFetch('/CommandInjection/LEVEL_1?ipaddress=127.0.0.1%7Cid');
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-18-command-injection-level-1');
  assert.doesNotMatch(res.text, /uid=\d+\(/, 'patched: injected `id` command output must not appear');
});
