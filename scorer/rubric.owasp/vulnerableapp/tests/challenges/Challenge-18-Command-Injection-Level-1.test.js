import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// OS command injection (id executed)

test('Challenge-18-Command-Injection-Level-1', async () => {
  const res = await vaFetch('/CommandInjection/LEVEL_1?ipaddress=127.0.0.1%7Cid');
  assert.doesNotMatch(res.text, /uid=\d+\(/, 'patched: injected `id` command output must not appear');
});
