import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadCatalogue } from "../src/catalogue.js";

const fixture = (n) => join(import.meta.dirname, "fixtures", n);

test("returns null when the target has no catalogue file", () => {
  assert.equal(loadCatalogue(fixture("rubric-valid"), "vampi"), null);
});

test("lowercases the catalogue key into the challenge id, keeping key verbatim", () => {
  const [first] = loadCatalogue(fixture("catalogue-vampi"), "vampi");
  assert.equal(first.key, "Challenge-1-Excessive-Data-Exposure");
  assert.equal(first.id, "challenge-1-excessive-data-exposure");
});

test("maps difficulty onto points and name onto name", () => {
  const [first] = loadCatalogue(fixture("catalogue-vampi"), "vampi");
  assert.equal(first.points, 1);
  assert.equal(first.name, "Excessive Data Exposure via Debug Endpoint");
});

test("defaults missing difficulty to 1 point", () => {
  const entries = loadCatalogue(fixture("catalogue-vampi"), "vampi");
  const noDiff = entries.find((c) => c.key === "Challenge-2-No-Difficulty");
  assert.equal(noDiff.points, 1);
});

test("rejects two keys that collide once lowercased", () => {
  assert.throws(
    () => loadCatalogue(fixture("catalogue-bad-dupe"), "vampi"),
    /duplicate challenge id: challenge-1-dupe/,
  );
});

test("rejects an unknown target rather than guessing a catalogue file", () => {
  assert.throws(() => loadCatalogue(fixture("catalogue-vampi"), "nope"), /unknown target: nope/);
});
