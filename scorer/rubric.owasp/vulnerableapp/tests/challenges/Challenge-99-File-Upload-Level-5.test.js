import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

await waitForVulnerableApp();

// malicious file upload accepted

test('Challenge-99-File-Upload-Level-5', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(["<svg onload=alert(1)>"], { type: 'text/html' }), "shell.svg");
  const res = await vaFetch('/UnrestrictedFileUpload/LEVEL_5', { method: 'POST', body: fd });
  assert.notEqual(res.json?.isValid, true, 'Malicious file upload must be rejected by the patch');
});
