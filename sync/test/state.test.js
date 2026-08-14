import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, repoState, markSeen } from "../src/state.js";

test("loadState returns empty state for missing or corrupt file", () => {
  assert.deepEqual(loadState("/nonexistent/state.json"), { repos: {} });
});

test("save/load round-trip creates directories", () => {
  const p = join(mkdtempSync(join(tmpdir(), "st-")), "deep", "state.json");
  const state = { repos: { DVWA: { since: "t1", etag: "e", seen: [1] } } };
  saveState(p, state);
  assert.deepEqual(loadState(p), state);
});

test("repoState initializes per-repo slot in place", () => {
  const state = { repos: {} };
  const rs = repoState(state, "DVWA");
  assert.deepEqual(rs, { since: null, etag: null, seen: [] });
  rs.since = "t1";
  assert.equal(state.repos.DVWA.since, "t1");
});

test("markSeen dedupes and caps at 500", () => {
  const rs = { since: null, etag: null, seen: [] };
  assert.equal(markSeen(rs, 42), true);
  assert.equal(markSeen(rs, 42), false);
  for (let i = 0; i < 600; i++) markSeen(rs, i);
  assert.equal(rs.seen.length, 500);
  assert.equal(rs.seen.includes(599), true);
});
