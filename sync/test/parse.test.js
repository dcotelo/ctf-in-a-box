import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScoreComment } from "../src/parse.js";

const CFG = { targets: ["dvwa", "juice-shop"] };
const block = (json) => `Scored ✅\n\n<!-- ctf-score: ${json} -->\n`;

test("extracts a valid payload", () => {
  const body = block(`{"author":"octocat","target":"dvwa","solved":["sqli-low"],"pr":7,"sha":"abc123"}`);
  assert.deepEqual(parseScoreComment(body, CFG), {
    author: "octocat", target: "dvwa", solved: ["sqli-low"], pr: 7, sha: "abc123",
  });
});

test("returns null without marker or with broken JSON", () => {
  assert.equal(parseScoreComment("no marker here", CFG), null);
  assert.equal(parseScoreComment(block(`{"author":`), CFG), null);
  assert.equal(parseScoreComment(null, CFG), null);
});

test("rejects invalid author (key-injection grammar)", () => {
  const bad = block(`{"author":"a:b","target":"dvwa","solved":[],"pr":1,"sha":"x"}`);
  assert.equal(parseScoreComment(bad, CFG), null);
});

test("rejects target not in this event", () => {
  const bad = block(`{"author":"octocat","target":"webgoat","solved":[],"pr":1,"sha":"x"}`);
  assert.equal(parseScoreComment(bad, CFG), null);
});

test("rejects non-string solved entries; defaults pr and sha", () => {
  assert.equal(parseScoreComment(block(`{"author":"o","target":"dvwa","solved":[1]}`), CFG), null);
  const min = parseScoreComment(block(`{"author":"o","target":"dvwa","solved":[]}`), CFG);
  assert.deepEqual(min, { author: "o", target: "dvwa", solved: [], pr: 0, sha: "" });
});
