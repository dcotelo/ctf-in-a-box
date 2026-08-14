/**
 * File Upload — pass-when-PATCHED (patch CTF).
 *
 * Each subtest pins a security level, replays the known bypass, and asserts the
 * upload success message does NOT appear in a normal 200 response. The upload
 * success string is the trigger signal — a patched endpoint rejects the file and
 * must NOT emit the "succesfully uploaded" confirmation.
 *
 * LOW:    No validation — any file including a raw .php shell is accepted.
 * MEDIUM: Checks the client-supplied Content-Type only — spoofing image/jpeg bypasses.
 * HIGH:   Checks extension + getimagesize() — a GIF/PHP polyglot with a .jpg
 *         extension satisfies both checks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch } from '../helpers.js';

const UPLOAD_URL = '/vulnerabilities/upload/';
const UPLOADED = (t) => /succesfully uploaded/i.test(t); // DVWA's (mis-spelled) success marker

/** A minimal but valid 1x1 GIF89a so getimagesize() succeeds. */
const GIF_HEADER = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02,
  0x00, 0x3b,
]);

const PHP_SHELL = '<?php echo "VULNERABLE"; ?>';

/** POST a multipart upload using the WHATWG FormData/Blob that fetch understands. */
async function uploadFile(cookies, { filename, contentType, bytes }) {
  const form = new FormData();
  form.append('uploaded', new Blob([bytes], { type: contentType }), filename);
  form.append('Upload', 'Upload');
  return dvwaFetch(UPLOAD_URL, { cookies, method: 'POST', body: form });
}

// ── LOW ──────────────────────────────────────────────────────────────────────

await test('Challenge-5-File-Upload-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  const { status, text } = await uploadFile(cookies, {
    filename: 'shell.php',
    contentType: 'application/x-php',
    bytes: Buffer.from(PHP_SHELL),
  });

  assert.equal(status, 200, 'patched upload endpoint should still serve a normal 200');
  assert.ok(!UPLOADED(text), 'upload-low must be blocked: a raw .php file must not be accepted');
});

// ── MEDIUM ───────────────────────────────────────────────────────────────────

await test('Challenge-5-File-Upload-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  // Spoof the Content-Type to image/jpeg while still shipping a .php shell.
  const { status, text } = await uploadFile(cookies, {
    filename: 'shell.php',
    contentType: 'image/jpeg',
    bytes: Buffer.from(PHP_SHELL),
  });

  assert.equal(status, 200, 'patched upload endpoint should still serve a normal 200');
  assert.ok(!UPLOADED(text), 'upload-medium must be blocked: spoofed MIME must not bypass extension check');
});

// ── HIGH ─────────────────────────────────────────────────────────────────────

await test('Challenge-5-File-Upload-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  // Image polyglot: valid GIF magic bytes (passes getimagesize()) + PHP payload, .jpg extension.
  const polyglot = Buffer.concat([GIF_HEADER, Buffer.from(PHP_SHELL)]);
  const { status, text } = await uploadFile(cookies, {
    filename: 'shell.jpg',
    contentType: 'image/jpeg',
    bytes: polyglot,
  });

  assert.equal(status, 200, 'patched upload endpoint should still serve a normal 200');
  assert.ok(!UPLOADED(text), 'upload-high must be blocked: GIF/PHP polyglot with .jpg extension must not be accepted');
});
