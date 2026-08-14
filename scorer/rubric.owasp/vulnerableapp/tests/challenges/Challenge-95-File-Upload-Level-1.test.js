import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// malicious file upload accepted

test('Challenge-95-File-Upload-Level-1', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(["<script>alert(1)</script>"], { type: 'text/html' }), "shell.html");
  const res = await vaFetch('/UnrestrictedFileUpload/LEVEL_1', { method: 'POST', body: fd });
  // Patched: dangerous .html upload must be rejected, not accepted.
  assert.notEqual(res.json?.isValid, true, 'malicious html upload should be rejected after patch');
});
