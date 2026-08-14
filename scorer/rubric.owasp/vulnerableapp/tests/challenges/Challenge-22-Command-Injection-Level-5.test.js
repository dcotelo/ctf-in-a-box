import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// OS command injection (id executed)

test('Challenge-22-Command-Injection-Level-5', async () => {
  const res = await vaFetch('/CommandInjection/LEVEL_5?ipaddress=127.0.0.1%0aid');
  assert.doesNotMatch(res.text, /uid=\d+\(/, 'patched: injected `id` command output must not appear');
});
