import { test } from "node:test";
import assert from "node:assert/strict";
import { tick } from "../src/index.js";

const CFG = {
  org: "evt", targets: ["dvwa"], pat: "p", apiUrl: "https://api.example",
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

test("scorer 5xx un-marks the comment so it retries next tick", async () => {
  const posts = [];
  const f = routes(() => new Response(JSON.stringify([ghComment(1)]), { status: 200, headers: {} }), 503, posts);
  const state = { repos: {} };
  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.equal(state.repos.DVWA.seen.includes(1), false);
});
