import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// malicious file upload accepted

test('Challenge-102-File-Upload-Level-8', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(["<script>alert(1)</script>"], { type: 'text/html' }), "shell.html");
  const res = await vaFetch('/UnrestrictedFileUpload/LEVEL_8', { method: 'POST', body: fd });
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-102-file-upload-level-8');
  assert.notEqual(res.json?.isValid, true, 'Malicious file upload must be rejected by the patch');
});
