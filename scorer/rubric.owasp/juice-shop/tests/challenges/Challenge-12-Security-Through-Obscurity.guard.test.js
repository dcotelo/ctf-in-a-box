import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeObjectHasGuard } from './lib/routeGuard.js';

// Regression tests for issue #24: the Challenge 12 scorer must detect the
// canActivate guard regardless of where it sits inside the route object.
// Angular route-object key order is semantically irrelevant, so a guard placed
// after `loadChildren` (form B) is exactly as secure as one placed before it
// (form A). The old fixed 200-char window scored form B as a false negative.

const FORM_A = `
  {
    path: 'web3-sandbox', // vuln-code-snippet vuln-line web3SandboxChallenge
    canActivate: [LoginGuard],
    loadChildren: async () => await loadWeb3SandboxModule() // vuln-code-snippet neutral-line web3SandboxChallenge
  },
  {
    path: 'chatbot',
    loadChildren: async () => await loadChatbotModule()
  }
`;

const FORM_B = `
  {
    path: 'web3-sandbox', // vuln-code-snippet vuln-line web3SandboxChallenge
    loadChildren: async () => await loadWeb3SandboxModule(), // vuln-code-snippet neutral-line web3SandboxChallenge
    canActivate: [LoginGuard]
  },
  {
    path: 'chatbot',
    loadChildren: async () => await loadChatbotModule()
  }
`;

const UNPATCHED = `
  {
    path: 'web3-sandbox', // vuln-code-snippet vuln-line web3SandboxChallenge
    loadChildren: async () => await loadWeb3SandboxModule() // vuln-code-snippet neutral-line web3SandboxChallenge
  },
  {
    path: 'chatbot',
    loadChildren: async () => await loadChatbotModule()
  }
`;

// A guard belonging to a DIFFERENT route must not leak across the object
// boundary and produce a false positive for web3-sandbox.
const GUARD_ON_NEIGHBOUR = `
  {
    path: 'web3-sandbox', // vuln-code-snippet vuln-line web3SandboxChallenge
    loadChildren: async () => await loadWeb3SandboxModule()
  },
  {
    path: 'chatbot',
    canActivate: [LoginGuard],
    loadChildren: async () => await loadChatbotModule()
  }
`;

test('form A — guard before loadChildren — passes', () => {
  assert.equal(routeObjectHasGuard(FORM_A, 'web3-sandbox', 'LoginGuard'), true);
});

test('form B — guard after loadChildren — passes (issue #24 regression)', () => {
  assert.equal(routeObjectHasGuard(FORM_B, 'web3-sandbox', 'LoginGuard'), true);
});

test('unpatched — no guard — fails', () => {
  assert.equal(routeObjectHasGuard(UNPATCHED, 'web3-sandbox', 'LoginGuard'), false);
});

test('guard on neighbouring route does not leak across object boundary', () => {
  assert.equal(routeObjectHasGuard(GUARD_ON_NEIGHBOUR, 'web3-sandbox', 'LoginGuard'), false);
});

test('missing route returns false rather than throwing', () => {
  assert.equal(routeObjectHasGuard('{ path: "other" }', 'web3-sandbox', 'LoginGuard'), false);
});
