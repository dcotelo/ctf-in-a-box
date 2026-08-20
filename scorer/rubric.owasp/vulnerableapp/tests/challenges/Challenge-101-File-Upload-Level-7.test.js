import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// malicious file upload accepted

test('Challenge-101-File-Upload-Level-7', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(["<script>alert(1)</script>"], { type: 'text/html' }), "shell.html%00.png");
  const res = await vaFetch('/UnrestrictedFileUpload/LEVEL_7', { method: 'POST', body: fd });
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-101-file-upload-level-7');
  assert.notEqual(res.json?.isValid, true, 'Malicious file upload must be rejected by the patch');
});
