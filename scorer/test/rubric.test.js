import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRubric } from "../src/rubric.js";

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));

const tmpRubric = (yaml, file = "juice-shop.yaml") => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-"));
  writeFileSync(join(dir, file), yaml);
  return dir;
};

test("valid rubric loads targets, points, and pass-through probes", () => {
  const rubric = loadRubric(fixture("rubric-valid"));
  assert.deepEqual([...rubric.targets.keys()], ["dvwa", "juice-shop"]);
  assert.equal(rubric.totalFor("juice-shop"), 2);
  assert.equal(rubric.totalFor("dvwa"), 1);
  assert.equal(rubric.pointsFor("juice-shop", "reflected-xss-search"), 10);
  assert.equal(rubric.pointsFor("juice-shop", "sql-injection-login"), 5);
  assert.equal(rubric.pointsFor("dvwa", "sqli-low"), 1); // default
  assert.equal(rubric.pointsFor("juice-shop", "nope"), undefined);
  assert.equal(rubric.totalFor("nope"), 0);
  // Probe contents are the judge's concern — the loader passes them through.
  const [xss] = rubric.targets.get("juice-shop").challenges;
  assert.deepEqual(xss.probes, [
    {
      request: { method: "GET", path: "/rest/products/search?q=<script>x</script>" },
      expect: { status: 200, bodyMissing: "<script>x</script>" },
    },
  ]);
});

test("missing or empty rubric dir returns null (serve's degenerate mode)", () => {
  assert.equal(loadRubric(fixture("no-such-dir")), null);
  assert.equal(loadRubric(mkdtempSync(join(tmpdir(), "rubric-empty-"))), null);
});

test("duplicate challenge id throws", () => {
  assert.throws(() => loadRubric(fixture("rubric-dup-id")), /duplicate challenge id: reflected-xss-search/);
});

test("bad id charset throws", () => {
  assert.throws(() => loadRubric(fixture("rubric-bad-id")), /id must match/);
});

test("missing name throws", () => {
  assert.throws(() => loadRubric(fixture("rubric-missing-name")), /name is required/);
});

test("missing probes throws", () => {
  assert.throws(() => loadRubric(fixture("rubric-missing-probes")), /probes must be a non-empty list/);
});

test("empty challenges throws", () => {
  assert.throws(() => loadRubric(fixture("rubric-empty-challenges")), /challenges must be a non-empty list/);
});

test("filename/target mismatch throws", () => {
  assert.throws(() => loadRubric(fixture("rubric-target-mismatch")), /does not match filename/);
});

test("unknown top-level key throws", () => {
  assert.throws(() => loadRubric(fixture("rubric-unknown-key")), /unknown key: notes/);
});

test("empty probes list throws", () => {
  const dir = tmpRubric(
    "target: juice-shop\nchallenges:\n  - id: a\n    name: n\n    probes: []\n",
  );
  assert.throws(() => loadRubric(dir), /probes must be a non-empty list/);
});

test("non-integer or sub-1 points throw", () => {
  const bad = (points) =>
    tmpRubric(`target: juice-shop\nchallenges:\n  - id: a\n    name: n\n    points: ${points}\n    probes: [{}]\n`);
  assert.throws(() => loadRubric(bad(0)), /points must be an integer >= 1/);
  assert.throws(() => loadRubric(bad(2.5)), /points must be an integer >= 1/);
});

test("unknown challenge key throws", () => {
  const dir = tmpRubric(
    "target: juice-shop\nchallenges:\n  - id: a\n    name: n\n    hint: nope\n    probes: [{}]\n",
  );
  assert.throws(() => loadRubric(dir), /unknown key: hint/);
});

test("bad target charset throws", () => {
  const dir = tmpRubric("target: Juice_Shop\nchallenges: []\n", "Juice_Shop.yaml");
  assert.throws(() => loadRubric(dir), /target must match/);
});
