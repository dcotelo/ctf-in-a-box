import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();

// malicious file upload accepted

test('Challenge-98-File-Upload-Level-4', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(["<svg onload=alert(1)>"], { type: 'text/html' }), "shell.svg");
  const res = await vaFetch('/UnrestrictedFileUpload/LEVEL_4', { method: 'POST', body: fd });
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-98-file-upload-level-4');
  assert.notEqual(res.json?.isValid, true, 'Malicious file upload must be rejected by the patch');
});
