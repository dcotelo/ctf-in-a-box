import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// SSRF reads local file via file:// scheme

test('Challenge-89-SSRF-Level-1', async () => {
  const res = await vaFetch('/SSRFVulnerability/LEVEL_1', { params: { fileurl: 'file:///etc/passwd' } });
  assert.doesNotMatch(res.text, /root:.*:0:0:/, 'local file contents must not be returned after patch');
});
