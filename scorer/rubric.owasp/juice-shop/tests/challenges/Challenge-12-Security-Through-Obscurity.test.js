import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeObjectHasGuard } from './lib/routeGuard.js';

// Resolve the app source root: CTF_UPSTREAM_DIR (set when the scorer runs sandboxed against a
// read-only mount of the PR source) overrides the in-repo default of ../../upstream.
const UPSTREAM = process.env.CTF_UPSTREAM_DIR
  ? path.resolve(process.env.CTF_UPSTREAM_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../upstream');
const ROUTING_FILE = path.join(UPSTREAM, 'frontend/src/app/app.routing.ts');

// The web3-sandbox route is an Angular lazy-loaded route with no canActivate guard,
// making the sandbox accessible to unauthenticated users.
// Because the SPA serves 200 for all /#/ routes, enforcement requires a guard compiled
// into the Angular bundle. We verify it is wired up in the TypeScript source.

test('Challenge 12 — Security Through Obscurity: web3-sandbox route must have canActivate: [LoginGuard]', () => {
  const content = fs.readFileSync(ROUTING_FILE, 'utf8');

  assert.ok(
    content.includes("'web3-sandbox'"),
    "web3-sandbox route not found in app.routing.ts"
  );

  // Structurally inspect the whole route object (not a fixed text window) so the
  // guard is detected regardless of where it sits among the route's keys and
  // regardless of how long the surrounding vuln-code-snippet comments are.
  assert.ok(
    routeObjectHasGuard(content, 'web3-sandbox', 'LoginGuard'),
    `canActivate: [LoginGuard] not found in the 'web3-sandbox' route object in app.routing.ts.\n` +
    `Add it to prevent unauthenticated access to the Web3 sandbox.`
  );
});
