import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enclosingObjectHasGuard } from './lib/routeGuard.js';

// Regression tests for the same class of bug as issue #24, found in the
// Challenge 8 (Blockchain Hype) scorer: the token-sale route uses a custom
// `matcher: tokenMatcher` instead of a `path:` string, but it was checked with
// the same brittle fixed 200-char window. A valid guard placed later in the
// route object (after `component`, nudged past the window by vuln-code-snippet
// comments) was scored as a false negative.

const ANCHOR = /matcher:\s*tokenMatcher/;

const FORM_A = `
  { // vuln-code-snippet neutral-line tokenSaleChallenge
    matcher: tokenMatcher, canActivate: [LoginGuard], // PATCH (tokenSaleChallenge)
    component: TokenSaleComponent // vuln-code-snippet neutral-line tokenSaleChallenge
  },
  {
    path: 'coding-challenge/:challengeKey',
    loadComponent: async () => await loadCodingChallenge()
  }
`;

const FORM_B = `
  { // vuln-code-snippet neutral-line tokenSaleChallenge
    matcher: tokenMatcher, // vuln-code-snippet vuln-line tokenSaleChallenge
    component: TokenSaleComponent, // vuln-code-snippet neutral-line tokenSaleChallenge
    canActivate: [LoginGuard] // PATCH (tokenSaleChallenge): require auth for the hidden token sale
  },
  {
    path: 'coding-challenge/:challengeKey',
    loadComponent: async () => await loadCodingChallenge()
  }
`;

const UNPATCHED = `
  { // vuln-code-snippet neutral-line tokenSaleChallenge
    matcher: tokenMatcher, // vuln-code-snippet vuln-line tokenSaleChallenge
    component: TokenSaleComponent // vuln-code-snippet neutral-line tokenSaleChallenge
  },
  {
    path: 'coding-challenge/:challengeKey',
    loadComponent: async () => await loadCodingChallenge()
  }
`;

// The anchor must bind to the route usage, not the `export function tokenMatcher`
// definition elsewhere in the file — and a guard on a neighbour must not leak in.
const GUARD_ON_NEIGHBOUR = `
  { // vuln-code-snippet neutral-line tokenSaleChallenge
    matcher: tokenMatcher,
    component: TokenSaleComponent
  },
  {
    path: 'coding-challenge/:challengeKey',
    canActivate: [LoginGuard],
    loadComponent: async () => await loadCodingChallenge()
  }

  export function tokenMatcher (url) { return null }
`;

test('form A — guard before component — passes', () => {
  assert.equal(enclosingObjectHasGuard(FORM_A, ANCHOR, 'LoginGuard'), true);
});

test('form B — guard after component — passes (issue #24 sibling regression)', () => {
  assert.equal(enclosingObjectHasGuard(FORM_B, ANCHOR, 'LoginGuard'), true);
});

test('unpatched — no guard — fails', () => {
  assert.equal(enclosingObjectHasGuard(UNPATCHED, ANCHOR, 'LoginGuard'), false);
});

test('guard on neighbouring route / function def does not leak in', () => {
  assert.equal(enclosingObjectHasGuard(GUARD_ON_NEIGHBOUR, ANCHOR, 'LoginGuard'), false);
});

test('missing anchor returns false rather than throwing', () => {
  assert.equal(enclosingObjectHasGuard('{ path: "other" }', ANCHOR, 'LoginGuard'), false);
});
