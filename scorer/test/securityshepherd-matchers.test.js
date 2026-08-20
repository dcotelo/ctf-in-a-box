import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSolutionKey,
  hasSolvedMessage,
} from "../rubric.owasp/securityshepherd/tests/helpers.js";

// The two matchers 29 of securityshepherd's 40 challenges decide on, via
// `assert.ok(!(hasSolvedMessage(body) || key))`. They are pure string functions,
// so they can be pinned here — in seconds, with no Tomcat, MariaDB and MongoDB —
// rather than only by the hour-long stock-scores-zero gate.
//
// Both fixtures below are REAL responses captured from the live app during the
// investigation of issue #42, not invented ones. That matters: the bug was a
// mismatch between what the matchers assumed a response looks like and what the
// app actually sends.

/** A genuine solve: the exploit worked and the app handed over the key. */
const SOLVE = `<h2 class='title'>Hidden User's Message</h2><p>Result Key is <a>1f746b87a4e3628b90b1927de23f6077abdbbb64586d3ac9485625da21921a0f</a></p>`;

/** A refusal — what a PATCHED app returns. The app echoes the submitted id, and
 *  the id Challenge-10-IDOR-2 submits is an MD5: 32 hex characters. */
const REFUSAL_ECHOING_THE_PAYLOAD = `<h2 class='title'>User: 404 - User Not Found</h2><p>User 'c51ce410c124a10e0db5e4b97fc2af39' could not be found or does not exist.</p>`;

/** The verdict a challenge computes. True means "the exploit still works". */
const readsAsUnpatched = (body) => Boolean(hasSolvedMessage(body) || extractSolutionKey(body));

test("a real solve is still detected — the stock target must never score", () => {
  // The direction that must not regress while fixing the other one. A matcher
  // tightened too far stops seeing a genuine solve, every challenge passes
  // against an unpatched app, and every contestant gets 40 free points.
  assert.equal(
    extractSolutionKey(SOLVE),
    "1f746b87a4e3628b90b1927de23f6077abdbbb64586d3ac9485625da21921a0f",
  );
  assert.equal(hasSolvedMessage(SOLVE), true);
  assert.equal(readsAsUnpatched(SOLVE), true);
});

test("a refusal that echoes the exploit payload does not read as a solve (#42)", () => {
  // The bug: the old `[0-9a-f]{32,128}` fallback matched the echoed 32-hex user
  // id, so the challenge read the test's OWN payload back out of the error page
  // and failed a contestant who had patched correctly.
  assert.equal(extractSolutionKey(REFUSAL_ECHOING_THE_PAYLOAD), null);
  assert.equal(hasSolvedMessage(REFUSAL_ECHOING_THE_PAYLOAD), false);
  assert.equal(readsAsUnpatched(REFUSAL_ECHOING_THE_PAYLOAD), false);
});

test("other refusal shapes the live app produces read as patched", () => {
  for (const id of ["ffffffffffffffffffffffffffffffff", "definitely-not-a-user", "", "null"]) {
    const body = `<h2 class='title'>User: 404 - User Not Found</h2><p>User '${id}' could not be found or does not exist.</p>`;
    assert.equal(readsAsUnpatched(body), false, `refusal echoing ${JSON.stringify(id)}`);
  }
});

test("an incidental 32-hex string is not a result key", () => {
  // A CSRF token, a session id or any other MD5-shaped value on the page. The
  // real key is 64 hex; nothing shorter counts without context.
  const page = `<input name="csrfToken" value="9f8e7d6c5b4a392817065f4e3d2c1b0a">`;
  assert.equal(extractSolutionKey(page), null);
});

test("a short key still counts when it carries its own context", () => {
  // Contextless matching is what got tightened, not contextual matching — a
  // challenge whose key is shorter than 64 keeps working as long as the app
  // says what it is.
  const body = `<p>Result Key is <a>0123456789abcdef0123</a></p>`;
  assert.equal(extractSolutionKey(body), "0123456789abcdef0123");
});

test("a resultKey JSON field wins regardless of length", () => {
  assert.equal(extractSolutionKey(`{"resultKey":"abc123","other":1}`), "abc123");
});

test("a refusal built on the word 'correct' is not a solved message", () => {
  // The unbounded `correct` alternative matched the "correct" inside
  // "incorrect", so a challenge whose refusal says so read as a solve. Not the
  // mechanism that fired on Challenge-10-IDOR-2 — that one says "could not be
  // found" — but the same class of defect, one alternative over.
  assert.equal(hasSolvedMessage("<p>Incorrect user id supplied.</p>"), false);
  assert.equal(hasSolvedMessage("<p>That answer was not correct.</p>"), false);
  // …while a genuine affirmative still counts.
  assert.equal(hasSolvedMessage("<p>Correct!</p>"), true);
  assert.equal(hasSolvedMessage("<p>That is correct.</p>"), true);
});

test("the known-unhandled negations are documented, not silently broken", () => {
  // Stated so the limit is visible in the suite rather than only in a comment:
  // these still read as solves. If either turns up in a real response, capture
  // the body and extend the matcher — that is how #42's fixtures got here.
  assert.equal(hasSolvedMessage("<p>That isn't correct.</p>"), true);
});
