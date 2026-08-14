import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the app source root: CTF_UPSTREAM_DIR (set when the scorer runs sandboxed against a
// read-only mount of the PR source) overrides the in-repo default of ../../upstream.
const UPSTREAM = process.env.CTF_UPSTREAM_DIR
  ? path.resolve(process.env.CTF_UPSTREAM_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../upstream');
const CHECK_KEYS_FILE = path.join(UPSTREAM, 'routes/checkKeys.ts');

// The known hardcoded mnemonic phrase from the unpatched source.
const HARDCODED_MNEMONIC = 'purpose betray marriage blame crunch monitor spin slide donate sport lift clutch';

// The vulnerability: the NFT wallet mnemonic is hardcoded in routes/checkKeys.ts.
// Anyone who reads the source (or the compiled bundle) can derive the private key
// and submit it to solve the nftUnlockChallenge.
//
// The patch: remove the hardcoded mnemonic and load it from process.env.NFT_WALLET_MNEMONIC.

test('Challenge 9 — Nautical Mystery: hardcoded mnemonic must be removed from routes/checkKeys.ts', () => {
  const content = fs.readFileSync(CHECK_KEYS_FILE, 'utf8');

  assert.ok(
    !content.includes(HARDCODED_MNEMONIC),
    `Hardcoded NFT wallet mnemonic found in routes/checkKeys.ts.\n` +
    `Remove it and load the mnemonic from process.env.NFT_WALLET_MNEMONIC instead.`
  );
});

test('Challenge 9 — Nautical Mystery: checkKeys.ts must load mnemonic from environment', () => {
  const content = fs.readFileSync(CHECK_KEYS_FILE, 'utf8');

  assert.ok(
    content.includes('NFT_WALLET_MNEMONIC') || content.includes('process.env'),
    `routes/checkKeys.ts does not reference an environment variable for the mnemonic.\n` +
    `Replace the hardcoded string with: const mnemonic = process.env.NFT_WALLET_MNEMONIC`
  );
});
