import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// malicious file upload accepted

test('Challenge-102-File-Upload-Level-8', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(["<script>alert(1)</script>"], { type: 'text/html' }), "shell.html");
  const res = await vaFetch('/UnrestrictedFileUpload/LEVEL_8', { method: 'POST', body: fd });
  assert.notEqual(res.json?.isValid, true, 'Malicious file upload must be rejected by the patch');
});
