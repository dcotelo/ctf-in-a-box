import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// malicious file upload accepted

test('Challenge-96-File-Upload-Level-2', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(["<script>alert(1)</script>"], { type: 'text/html' }), "shell.html");
  const res = await vaFetch('/UnrestrictedFileUpload/LEVEL_2', { method: 'POST', body: fd });
  // Patched: dangerous .html upload must be rejected, not accepted.
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-96-file-upload-level-2');
  assert.notEqual(res.json?.isValid, true, 'malicious html upload should be rejected after patch');
});
