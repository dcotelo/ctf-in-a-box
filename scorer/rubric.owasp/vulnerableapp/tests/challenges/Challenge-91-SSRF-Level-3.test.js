import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// SSRF to metadata via IPv6-mapped address bypass

test('Challenge-91-SSRF-Level-3', async () => {
  const res = await vaFetch('/SSRFVulnerability/LEVEL_3', { params: { fileurl: 'http://[::ffff:169.254.169.254]/latest/meta-data' } });
  assert.doesNotMatch(res.text, /ami-id|instance-id|meta-data/, 'cloud metadata must not be reachable via IPv6-mapped bypass after patch');
});
