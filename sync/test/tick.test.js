import { test } from "node:test";
import assert from "node:assert/strict";
import { tick } from "../src/index.js";

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
  // logged as a rejected/dropped submission, not silently swallowed
  assert.equal(logs.length, 1);
  assert.match(logs[0], /rejected \(4xx\), dropped/);
  // comment stays marked seen (permanent drop) — unlike the 5xx retry case
  assert.equal(state.repos.DVWA.seen.includes(1), true);
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
  assert.equal(state.repos.DVWA.seen.includes(1), false);
  assert.equal(state.repos.DVWA.seen.includes(2), true);

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
  assert.equal(state.repos.DVWA.seen.includes(1), true);
  assert.equal(state.repos.DVWA.seen.includes(2), true);
  assert.equal(state.repos.DVWA.since, "2026-08-13T11:01:00Z");
  assert.equal(state.repos.DVWA.etag, 'W/"batch2"');
});
