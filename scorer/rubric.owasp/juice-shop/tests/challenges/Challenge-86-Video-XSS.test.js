import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAndLogin, waitForServer } from '../helpers.js';

// NOTE: this test is self-contained on purpose. It previously imported buildZipSlip from
// `../../../scripts/solve/zipslip.mjs`, a 3-levels-up path that is only correct in the
// monorepo layout (juice-shop/tests/challenges → repo root). The scorer embeds the rubric
// FLAT (tests/challenges/… and scripts/solve/… become siblings under the rubric temp dir),
// so 3-up escaped the rubric root and the import failed with ERR_MODULE_NOT_FOUND — making
// the whole test error at load and the challenge report "open" regardless of the patch.
// Inlining the builder (as Challenge-6-Arbitrary-File-Write does) removes the fragile cross-dir dependency.
function buildZipSlip(name, content) {
  const nameBuf = Buffer.from(name);
  const data = Buffer.from(content);
  let c = ~0;
  for (const b of data) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  const crc = ~c >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  const localRec = Buffer.concat([local, nameBuf, data]);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42);
  const centralRec = Buffer.concat([central, nameBuf]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralRec.length, 12); end.writeUInt32LE(localRec.length, 16);
  return Buffer.concat([localRec, centralRec, end]);
}

await waitForServer();

const BASE = process.env.JUICE_SHOP_URL ?? 'http://localhost:3000';

// A zip-slip upload must NOT be able to overwrite the promo subtitle file with an
// XSS payload — the /promotion page must not serve an injected script.
test('videoXssChallenge — zip-slip must not overwrite the promo subtitles', async () => {
  const token = await registerAndLogin({ email: `ctf-vxss-${Date.now()}@local.test`, password: 'CtfTester!23' });

  const vtt = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:10.000\n</script><script>alert(`xss`)</script>\n';
  const buf = buildZipSlip('../../frontend/dist/frontend/assets/public/videos/owasp_promo.vtt', vtt);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), 'subs.zip');
  await fetch(`${BASE}/file-upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });

  await new Promise((r) => setTimeout(r, 400));
  const res = await fetch(`${BASE}/promotion`);
  const html = await res.text();
  assert.ok(!html.includes('</script><script>alert(`xss`)</script>'), 'promo page must not serve an injected XSS subtitle');
});
