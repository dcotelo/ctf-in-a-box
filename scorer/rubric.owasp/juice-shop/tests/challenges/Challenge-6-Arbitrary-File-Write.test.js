import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForServer, assertShopAlive } from '../helpers.js';

await waitForServer();

const BASE = process.env.JUICE_SHOP_URL ?? 'http://localhost:3000';

// Build a minimal ZIP whose single entry name is a path-traversal sequence. unzipper
// reads the entry name verbatim, so an unpatched handler resolves it OUTSIDE
// uploads/complaints/ and overwrites the target.
function buildTraversalZip(entryName, content) {
  const nameBytes = Buffer.from(entryName);
  const dataBytes = Buffer.from(content);

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (const b of buf) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
  function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

  const crc = crc32(dataBytes);
  const local = Buffer.concat([
    Buffer.from([0x50, 0x4B, 0x03, 0x04]),
    u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(dataBytes.length), u32(dataBytes.length),
    u16(nameBytes.length), u16(0), nameBytes,
  ]);
  const central = Buffer.concat([
    Buffer.from([0x50, 0x4B, 0x01, 0x02]),
    u16(0x314), u16(20), u16(0), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(dataBytes.length), u32(dataBytes.length),
    u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), nameBytes,
  ]);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4B, 0x05, 0x06]),
    u16(0), u16(0), u16(1), u16(1),
    u32(central.length), u32(local.length + dataBytes.length), u16(0),
  ]);
  return Buffer.concat([local, dataBytes, central, eocd]);
}

// The exploit is verified ENTIRELY over HTTP against the app under test — never by reading
// the scorer's own filesystem. The app serves ftp/legal.md at /ftp/legal.md, so a successful
// zip-slip overwrite of ../../ftp/legal.md is observable as a changed download. (The previous
// version read ../../upstream/ftp/legal.md on the test runner's disk, which lives in a
// different container than the app — so it could never see the write and always passed.)
test('Challenge 6 — Arbitrary File Write: ZIP path traversal must not overwrite ftp/legal.md', async () => {
  // Anti-vacuous, part one: the shop has to be serving at all. This test's
  // status assertion accepts 500, so a server-error target satisfied it for
  // free (docs/scorer.md, #47).
  await assertShopAlive();

  // Baseline: the file the app serves before the exploit.
  const before = await fetch(`${BASE}/ftp/legal.md`);

  // Anti-vacuous, part two, and the reason this file needs more than the
  // standard guard. The whole test is "did ftp/legal.md change?", so an app
  // that does not serve ftp/legal.md cannot answer the question — yet the
  // original code read that case as a pass twice over: `originalContent`
  // became null, which SKIPPED the content comparison entirely, and the
  // `after` fetch then yielded '' so the sentinel check succeeded against an
  // empty string. Both halves of the verdict came from the file being absent.
  if (!before.ok) {
    throw new Error(
      `anti-vacuous precondition failed: /ftp/legal.md returned ${before.status}. This test ` +
        `decides by comparing that file before and after the upload, so without it "the file ` +
        `was not overwritten" proves nothing.`,
    );
  }
  const originalContent = await before.text();
  if (originalContent.length === 0) {
    throw new Error(
      'anti-vacuous precondition failed: /ftp/legal.md served an empty body, so a traversal ' +
        'write could not be distinguished from the file simply being empty.',
    );
  }

  const sentinel = `PWNED-${Date.now()}-${Math.round(performance.now())}`;
  const maliciousZip = buildTraversalZip('../../ftp/legal.md', sentinel);

  const form = new FormData();
  form.append('file', new Blob([maliciousZip], { type: 'application/zip' }), 'exploit.zip');

  const res = await fetch(`${BASE}/file-upload`, { method: 'POST', body: form });
  assert.ok(
    [204, 400, 415, 500].includes(res.status),
    `Unexpected status from /file-upload: ${res.status}`
  );

  // The write happens on an async unzip stream — give it a moment to flush.
  await new Promise(r => setTimeout(r, 1000));

  const after = await fetch(`${BASE}/ftp/legal.md`);
  // The same reasoning as the baseline: `after.ok ? … : ''` turned "the app
  // stopped serving the file" into an empty string that passes the sentinel
  // check. If the file is unreadable now, the exploit's effect is unknown, not
  // absent — and an upload that took the app down must not read as containment.
  if (!after.ok) {
    throw new Error(
      `anti-vacuous precondition failed: /ftp/legal.md returned ${after.status} AFTER the ` +
        `upload, so whether the traversal overwrote it cannot be determined.`,
    );
  }
  const currentContent = await after.text();

  // The sentinel is unique, so it can only appear if the traversal write succeeded AND the
  // app served the overwritten file — an unambiguous signal of an un-contained zip-slip.
  assert.ok(
    !currentContent.includes(sentinel),
    `ftp/legal.md was overwritten via ZIP path traversal — enforce path containment in ` +
    `routes/fileUpload.ts (resolved entry path must startsWith uploads/complaints/, not just ` +
    `include the project root).`
  );
  // Unconditional now: both sides are known to have been served, so the
  // comparison can no longer be skipped by the file being missing.
  assert.equal(currentContent, originalContent, 'ftp/legal.md content must be unchanged by the upload');
});
