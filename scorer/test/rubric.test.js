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

test("loads an exec rubric from a <target>/tests/challenges directory", () => {
  const r = loadRubric(fixture("rubric-exec"));
  assert.deepEqual([...r.targets.keys()], ["vampi"]);
  const [c] = r.targets.get("vampi").challenges;
  assert.equal(c.id, "challenge-1-ok");
  assert.equal(c.exec.key, "Challenge-1-Ok");
  assert.equal(c.exec.byName, true);
  assert.equal(c.probes, undefined);
});

test("exec challenges price from catalogue difficulty", () => {
  const r = loadRubric(fixture("rubric-exec"));
  assert.equal(r.pointsFor("vampi", "challenge-1-ok"), 3);
  assert.equal(r.totalFor("vampi"), 1);
});

test("a rubric dir may mix a YAML target and an exec target", () => {
  const r = loadRubric(fixture("rubric-mixed"));
  assert.deepEqual([...r.targets.keys()].sort(), ["juice-shop", "vampi"]);
  const js = r.targets.get("juice-shop").challenges[0];
  const vp = r.targets.get("vampi").challenges[0];
  assert.ok(Array.isArray(js.probes), "yaml target keeps declarative probes");
  assert.ok(vp.exec, "exec target carries an exec descriptor");
});

test("a target defined as BOTH an exec dir and a yaml file is rejected", () => {
  assert.throws(
    () => loadRubric(fixture("rubric-conflict")),
    /target "vampi" is defined twice: as an exec directory and as vampi\.yaml/,
  );
});
