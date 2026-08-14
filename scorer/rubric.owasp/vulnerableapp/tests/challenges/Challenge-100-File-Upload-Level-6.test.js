import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// malicious file upload accepted

test('Challenge-100-File-Upload-Level-6', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(["<script>alert(1)</script>"], { type: 'text/html' }), "shell.png.html");
  const res = await vaFetch('/UnrestrictedFileUpload/LEVEL_6', { method: 'POST', body: fd });
  assert.notEqual(res.json?.isValid, true, 'Malicious file upload must be rejected by the patch');
});
