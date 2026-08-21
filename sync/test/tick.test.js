import { test } from "node:test";
import assert from "node:assert/strict";
import { tick } from "../src/index.js";
import { seenKey } from "../src/state.js";

const CFG = {
  org: "evt", targets: ["dvwa"], getToken: async () => "ghp_test", apiUrl: "https://api.example",
  scorerUrl: "http://scorer:4000", scorerToken: "t", commentAuthor: "github-actions[bot]",
};

const scoreBody = `<!-- ctf-score: {"author":"octocat","target":"dvwa","solved":["sqli-low"],"pr":7,"sha":"abc"} -->`;
const ghComment = (id, body = scoreBody) => ({ id, body, user: { login: "github-actions[bot]" }, updated_at: "2026-08-13T11:00:00Z" });

function routes(commentsRes, scoreStatus = 202, posts = []) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes("/issues/comments")) return commentsRes();
    if (u.endsWith("/score")) {
      posts.push(JSON.parse(opts.body));
      return new Response(null, { status: scoreStatus });
    }
    throw new Error(`unexpected url ${u}`);
  };
}

test("polls, parses and submits new score comments once", async () => {
  const posts = [];
  const f = routes(() => new Response(JSON.stringify([ghComment(1)]), { status: 200, headers: { etag: 'W/"e"' } }), 202, posts);
  const state = { repos: {} };
  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].author, "octocat");
  // second tick with same comment id: seen-set suppresses the repost
  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(posts.length, 1);
});

test("poll failure for one repo is logged, not thrown", async () => {
  const logs = [];
  const f = async () => new Response("x", { status: 500 });
  await tick(CFG, { repos: {} }, { fetchImpl: f, log: (m) => logs.push(m) });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /DVWA/);
});

test("scorer 4xx logs a rejection and permanently drops the comment", async () => {
  const posts = [];
  const f = routes(() => new Response(JSON.stringify([ghComment(1)]), { status: 200, headers: {} }), 401, posts);
  const state = { repos: {} };
  const logs = [];
  await tick(CFG, state, { fetchImpl: f, log: (m) => logs.push(m) });
  assert.equal(posts.length, 1);
  // logged as a rejected/dropped submission, not silently swallowed. Matched
  // by content, not by line count — the tick also emits a per-repo
  // disposition summary (see drop-visibility.test.js), and a count assertion
  // here would fail on any future line without saying anything about whether
  // the rejection itself was reported.
  assert.ok(logs.some((l) => /rejected \(4xx\), dropped/.test(l)));
  // comment stays marked seen (permanent drop) — unlike the 5xx retry case
  assert.equal(state.repos.DVWA.seen.includes(seenKey(1, "2026-08-13T11:00:00Z")), true);
});

test("scorer 5xx un-marks the comment so it retries next tick", async () => {
  const posts = [];
  const f = routes(() => new Response(JSON.stringify([ghComment(1)]), { status: 200, headers: {} }), 503, posts);
  const state = { repos: {} };
  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(state.repos.DVWA.seen.includes(1), false);
});

test("2-comment batch: first fails 5xx, second succeeds 202; cursor stops at first", async () => {
  const posts = [];
  const comment1 = ghComment(1, `<!-- ctf-score: {"author":"octocat","target":"dvwa","solved":["sqli-low"],"pr":7,"sha":"abc"} -->`);
  comment1.updated_at = "2026-08-13T11:00:00Z";
  const comment2 = ghComment(2, `<!-- ctf-score: {"author":"mona","target":"dvwa","solved":["xss"],"pr":8,"sha":"def"} -->`);
  comment2.updated_at = "2026-08-13T11:01:00Z";

  const f = async (url, opts) => {
    const u = String(url);
    if (u.includes("/issues/comments")) {
      return new Response(JSON.stringify([comment1, comment2]), { status: 200, headers: { etag: 'W/"batch"' } });
    }
    if (u.endsWith("/score")) {
      const payload = JSON.parse(opts.body);
      posts.push(payload);
      // 5xx for octocat, 202 for mona
      return new Response(null, { status: payload.author === "octocat" ? 503 : 202 });
    }
    throw new Error(`unexpected url ${u}`);
  };

  const state = { repos: {} };
  const logs = [];
  await tick(CFG, state, { fetchImpl: f, log: (m) => logs.push(m) });

  // both were attempted to be submitted
  assert.equal(posts.length, 2);
  assert.equal(posts[0].author, "octocat");
  assert.equal(posts[1].author, "mona");

  // seen: 1 was un-marked (failed), 2 was kept (succeeded)
  assert.equal(state.repos.DVWA.seen.includes(seenKey(1, "2026-08-13T11:00:00Z")), false);
  assert.equal(state.repos.DVWA.seen.includes(seenKey(2, "2026-08-13T11:01:00Z")), true);

  // cursor stops at first failure's updated_at
  assert.equal(state.repos.DVWA.since, "2026-08-13T11:00:00Z");
  assert.equal(state.repos.DVWA.etag, null);

  // second tick: fetch again from first comment's time, both succeed
  const posts2 = [];
  const f2 = async (url, opts) => {
    const u = String(url);
    if (u.includes("/issues/comments")) {
      // both comments returned again
      return new Response(JSON.stringify([comment1, comment2]), { status: 200, headers: { etag: 'W/"batch2"' } });
    }
    if (u.endsWith("/score")) {
      const payload = JSON.parse(opts.body);
      posts2.push(payload);
      return new Response(null, { status: 202 });
    }
    throw new Error(`unexpected url ${u}`);
  };

  await tick(CFG, state, { fetchImpl: f2, log: () => {} });

  // comment 1 was re-submitted (un-marked on first tick), comment 2 was skipped (still in seen)
  assert.equal(posts2.length, 1);
  assert.equal(posts2[0].author, "octocat");

  // both in seen now, cursor advanced fully
  assert.equal(state.repos.DVWA.seen.includes(seenKey(1, "2026-08-13T11:00:00Z")), true);
  assert.equal(state.repos.DVWA.seen.includes(seenKey(2, "2026-08-13T11:01:00Z")), true);
  assert.equal(state.repos.DVWA.since, "2026-08-13T11:01:00Z");
  assert.equal(state.repos.DVWA.etag, 'W/"batch2"');
});

// ── issue #63: a malformed state file must not take ingestion down ───────────
//
// The unit tests in state.test.js pin the repair. This pins the SYMPTOM, at the
// level where it actually bit: `repoState` threw inside tick, outside the
// per-repo try that catches poll failures, so the rejection reached main's
// fatal handler and exited 1 — which compose restarted, into the same file.
//
// Written against `tick` rather than `loadState` on purpose: a state object
// can reach tick from somewhere other than a freshly-loaded file (a master
// reset reassigns `state.repos` mid-tick), and this is the boundary that has
// to hold regardless of how the object got here.

test("a bare {} state polls normally instead of throwing", async () => {
  const posts = [];
  const f = routes(() => new Response(JSON.stringify([ghComment(11)]), { status: 200 }), 202, posts);
  const state = {}; // no `repos` at all — what `{}` on disk deserializes to
  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(posts.length, 1, "the poll must still ingest, not merely survive");
  assert.deepEqual(Object.keys(state.repos), ["DVWA"]);
});

test("a per-repo entry with a junk seen list still dedupes", async () => {
  const posts = [];
  const f = routes(() => new Response(JSON.stringify([ghComment(12)]), { status: 200 }), 202, posts);
  // `seen` as a string is the crash one level down: markSeen calls
  // rs.seen.includes(id) immediately.
  const state = { repos: { DVWA: { since: null, etag: null, seen: "corrupt" } } };
  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(posts.length, 1);
  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(posts.length, 1, "the repaired seen-set must still suppress a repost");
});

// ── the upserted score comment (silent scoring loss) ─────────────────────────
//
// The scoring workflow posts ONE comment per target and edits it: "⏳ Scoring
// in progress…" first, the result second. So a PR whose first run produces no
// score — a transient failure, a missing package grant, an infrastructure
// break — has its comment id consumed by the placeholder. Dedupe on the id
// alone then made the re-run's real score unreachable forever, and silently:
// the loop `continue`s before it reaches any logged branch.
//
// Observed live: DVWA comment 5364196433, created 01:47 reading "Scoring did
// not complete", updated 02:06 carrying a real marker, never ingested. The
// PR showed a correct score; the leaderboard showed nothing.
test("ingests the real score when a placeholder comment is later edited into one", async () => {
  const posts = [];
  const placeholder = {
    id: 99,
    body: "<!-- ctf-score:dvwa -->\n## 🏆 CTF Patch Score\n\n❌ Scoring did not complete.",
    user: { login: "github-actions[bot]" },
    updated_at: "2026-08-13T11:00:00Z",
  };
  const scored = {
    id: 99, // SAME comment — the workflow upserts it
    body: `<!-- ctf-score:dvwa -->\n${scoreBody}`,
    user: { login: "github-actions[bot]" },
    updated_at: "2026-08-13T11:20:00Z",
  };

  let current = placeholder;
  const f = routes(() => new Response(JSON.stringify([current]), { status: 200, headers: {} }), 202, posts);
  const state = { repos: {} };

  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(posts.length, 0, "the placeholder carries no marker, so nothing is submitted");

  current = scored;
  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(posts.length, 1, "the edit carrying the real score MUST be ingested");
  assert.equal(posts[0].author, "octocat");
  assert.deepEqual(posts[0].solved, ["sqli-low"]);

  // …and still exactly once: a third tick with no further edit re-submits nothing.
  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(posts.length, 1);
});

// The repair path for events already carrying the damage: state written by an
// older build holds bare ids, which cannot match a revision key, so the first
// tick after upgrading re-presents the comment and the lost score lands.
test("recovers a score dropped by an older build's id-only seen entry", async () => {
  const posts = [];
  const c = ghComment(1234);
  const f = routes(() => new Response(JSON.stringify([c]), { status: 200, headers: {} }), 202, posts);
  const state = { repos: { DVWA: { since: "2026-08-13T10:00:00Z", etag: null, seen: [1234] } } };

  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(posts.length, 1, "a bare id from an older build must not suppress the comment forever");
});
