/**
 * Path Traversal — A01:2025 (improper limitation of a pathname). Pass-on-patch:
 * each subtest sends the IDENTICAL exploit bytes but PASSES only when the exploit is BLOCKED.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

const pic = Buffer.from('test-image-bytes');

function multipart(fields) {
  const form = new FormData();
  for (const [name, value, filename] of fields) {
    if (filename !== undefined) form.append(name, new Blob([value]), filename);
    else form.append(name, value);
  }
  return form;
}

await test('Challenge-46-Path-Traversal-Upload', async () => {
  // fullName=../guess escapes the per-user dir so the file lands in .../PathTraversal.
  const res = await wgFetch('/PathTraversal/profile-upload', {
    cookies, method: 'POST',
    body: multipart([['uploadedFile', pic, 'pic.png'], ['fullName', '../guess']]),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-48-Path-Traversal-Secure-Upload', async () => {
  // The "fix" strips "../" once (non-recursive); "..././" collapses back to "../".
  const res = await wgFetch('/PathTraversal/profile-upload-fix', {
    cookies, method: 'POST',
    body: multipart([['uploadedFileFix', pic, 'pic.png'], ['fullNameFix', '..././guess']]),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-47-Path-Traversal-Partial-Fix', async () => {
  // The server trusts the multipart filename — put the traversal there.
  const res = await wgFetch('/PathTraversal/profile-upload-remove-user-input', {
    cookies, method: 'POST',
    body: multipart([['uploadedFileRemoveUserInput', pic, '../guess.png']]),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-49-Path-Traversal-Directory', async () => {
  // The "secret" is just sha512hex(username); username is webgoat.
  const secret = crypto.createHash('sha512').update('webgoat').digest('hex');
  const res = await wgFetch('/PathTraversal/random', {
    cookies, method: 'POST', body: new URLSearchParams({ secret }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});


// Minimal STORED-method zip writer (avoids extra deps); crc + local header + central dir.
function buildZip(name, content) {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const crc = zlib.crc32 ? zlib.crc32(data) : crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // store
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc >>> 0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  const localRec = Buffer.concat([local, nameBuf, data]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc >>> 0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  const centralRec = Buffer.concat([central, nameBuf]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralRec.length, 12);
  end.writeUInt32LE(localRec.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localRec, centralRec, end]);
}

// CRC-32 fallback for runtimes without zlib.crc32.
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
