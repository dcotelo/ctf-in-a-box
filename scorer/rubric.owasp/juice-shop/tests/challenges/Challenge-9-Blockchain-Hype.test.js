import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enclosingObjectHasGuard } from './lib/routeGuard.js';

// Resolve the app source root: CTF_UPSTREAM_DIR (set when the scorer runs sandboxed against a
// read-only mount of the PR source) overrides the in-repo default of ../../upstream.
const UPSTREAM = process.env.CTF_UPSTREAM_DIR
  ? path.resolve(process.env.CTF_UPSTREAM_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../upstream');
const ROUTING_FILE = path.join(UPSTREAM, 'frontend/src/app/app.routing.ts');

// The token sale route uses a custom `tokenMatcher` function (not a plain `path:` string).
// Because this is an Angular SPA route the server always returns 200 for any /#/ URL —
// enforcement requires a canActivate guard compiled into the Angular bundle.
// We verify the guard is wired up in the TypeScript source, which is the file
// contestants must patch.

test('Challenge 8 — Blockchain Hype: token sale route must have canActivate: [LoginGuard]', () => {
  const content = fs.readFileSync(ROUTING_FILE, 'utf8');

  assert.ok(
    content.includes('tokenMatcher'),
    'tokenMatcher not found in app.routing.ts — was the route removed entirely? (also acceptable as a patch)'
  );

  // Structurally inspect the whole route object that uses `matcher: tokenMatcher`
  // (not a fixed text window) so the guard is detected regardless of where it
  // sits among the route's keys and regardless of surrounding comment length.
  assert.ok(
    enclosingObjectHasGuard(content, /matcher:\s*tokenMatcher/, 'LoginGuard'),
    `canActivate: [LoginGuard] not found in the tokenMatcher route object in app.routing.ts.\n` +
    `Add it to prevent unauthenticated access to the token sale page.`
  );
});
