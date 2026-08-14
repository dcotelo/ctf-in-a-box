// A passing fixture challenge — and, for free, the judge's env-wiring test.
//
// judge.js is the ONLY thing that maps APP_URL onto the target's conventional
// URL variable (targets.js `urlEnv` — VAMPI_URL here), and every vendored
// rubric helper reads that variable rather than APP_URL. If that one line
// regressed, all six targets would score 0 / N against a perfectly reachable
// app and every gate in the repo would still pass, because "stock scores zero"
// is exactly what a broken wiring looks like. So this challenge passes only
// when VAMPI_URL carries the APP_URL that judge.test.js hands in; the judge
// test's `solved: ["challenge-1-ok"]` assertion then fails if the wiring goes.
import { test } from "node:test";
import assert from "node:assert/strict";

test("Challenge-1-Ok", () => {
  assert.equal(process.env.VAMPI_URL, "http://app.invalid");
});
