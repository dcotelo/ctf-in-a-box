import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS, getTarget } from "../src/targets.js";

const scorerRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("covers exactly the six kit targets", () => {
  assert.deepEqual(Object.keys(TARGETS).sort(), [
    "dvwa", "juice-shop", "securityshepherd", "vampi", "vulnerableapp", "webgoat",
  ]);
});

// Parity guard: the target list lives in three places inside the scorer image —
// the src/targets.js scoring table, one bring-up per target in entrypoints/, and
// one vendored rubric dir per target in rubric.owasp/. They MUST name the same
// set, or a re-vendor that adds/drops a target (scripts/vendor-rubric.sh) would
// silently leave a target unscoreable or an entrypoint dangling. This is the
// scorer-internal half of the cross-package parity the app already tests
// (apps/web apps.test.ts covers apps.ts ↔ sync config ↔ catalogue).
test("targets.js, the entrypoints, and the vendored rubric dirs name the same six targets", () => {
  const fromTargets = Object.keys(TARGETS).sort();
  const fromEntrypoints = fs
    .readdirSync(path.join(scorerRoot, "entrypoints"))
    .filter((f) => f.endsWith(".sh"))
    .map((f) => f.replace(/\.sh$/, ""))
    .sort();
  const fromRubric = fs
    .readdirSync(path.join(scorerRoot, "rubric.owasp"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  assert.deepEqual(fromEntrypoints, fromTargets, "scorer/entrypoints/*.sh must match TARGETS in src/targets.js");
  assert.deepEqual(fromRubric, fromTargets, "scorer/rubric.owasp/<target> dirs must match TARGETS in src/targets.js");
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

test("every target names the URL env var its tests read", () => {
  for (const [name, spec] of Object.entries(TARGETS)) {
    assert.match(spec.urlEnv, /^[A-Z][A-Z0-9_]*_URL$/, `${name} needs a urlEnv`);
  }
});
