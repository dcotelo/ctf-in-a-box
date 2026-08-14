import { test } from "node:test";
import assert from "node:assert/strict";
import { TARGETS, getTarget } from "../src/targets.js";

test("covers exactly the six kit targets", () => {
  assert.deepEqual(Object.keys(TARGETS).sort(), [
    "dvwa", "juice-shop", "securityshepherd", "vampi", "vulnerableapp", "webgoat",
  ]);
});

test("byName reflects how each target's tests are laid out", () => {
  // Shared file per category, one subtest per challenge.
  assert.equal(TARGETS.dvwa.byName, true);
  assert.equal(TARGETS.webgoat.byName, true);
  assert.equal(TARGETS.securityshepherd.byName, true);
  assert.equal(TARGETS.vampi.byName, true);
  // One self-contained file per challenge.
  assert.equal(TARGETS["juice-shop"].byName, false);
  assert.equal(TARGETS.vulnerableapp.byName, false);
});

test("securityshepherd stays serial because its tests mutate shared server state", () => {
  assert.equal(TARGETS.securityshepherd.defaultConcurrency, 1);
});

test("vulnerableapp parallelizes its 110 stateless files", () => {
  assert.equal(TARGETS.vulnerableapp.defaultConcurrency, 8);
});

test("getTarget returns undefined for an unknown target rather than a default", () => {
  assert.equal(getTarget("nope"), undefined);
  assert.equal(getTarget(undefined), undefined);
});
