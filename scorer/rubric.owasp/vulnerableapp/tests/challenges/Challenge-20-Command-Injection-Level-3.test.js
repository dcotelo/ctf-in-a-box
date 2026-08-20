import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertAnswered } from '../helpers.js';

await waitForVulnerableApp();

// OS command injection (id executed)

test('Challenge-20-Command-Injection-Level-3', async () => {
  const res = await vaFetch('/CommandInjection/LEVEL_3?ipaddress=127.0.0.1%0aid');
  // Anti-vacuous: prove the level actually answered before trusting the
  // absence assertion below (docs/scorer.md, #47).
  assertAnswered(res, 'challenge-20-command-injection-level-3');
  assert.doesNotMatch(res.text, /uid=\d+\(/, 'patched: injected `id` command output must not appear');
});
