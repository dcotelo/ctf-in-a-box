import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadRubric } from "../src/rubric.js";
import { createMemoryStore } from "../src/store.js";
import { createHandler, startServer } from "../src/serve.js";

const RUBRIC = loadRubric(fileURLToPath(new URL("./fixtures/rubric-valid/", import.meta.url)));
const TOKEN = "s3cret";
const T = [
  "2026-08-14T10:00:00.000Z",
  "2026-08-14T11:00:00.000Z",
  "2026-08-14T12:00:00.000Z",
  "2026-08-14T13:00:00.000Z",
];

// Deterministic clock: one timestamp per POST, last one repeats.
const clock = (times = T) => {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
};

async function boot(t, { rubric = RUBRIC, now = clock() } = {}) {
  const server = await startServer({ rubric, store: createMemoryStore(), token: TOKEN, now });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, auth = `Bearer ${TOKEN}`) =>
    fetch(`${base}/score`, {
      method: "POST",
      headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const board = async () => (await fetch(`${base}/leaderboard`)).json();
  return { base, post, board };
}

const solve = (author, target, solved) => ({ author, target, solved, pr: 7, sha: "abc123" });

test("refuses to start without a bearer token", () => {
  assert.throws(
    () => createHandler({ store: createMemoryStore() }),
    /CTF_SCORE_BEARER_TOKEN or SCORER_TOKEN/,
  );
});

test("healthz and leaderboard are unauthenticated; everything else 404", async (t) => {
  const { base, board } = await boot(t);
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  assert.deepEqual(await board(), { leaderboard: [] });
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/score`)).status, 404); // GET /score is not a route
});

test("POST /score requires the exact bearer token", async (t) => {
  const { post } = await boot(t);
  assert.equal((await post(solve("octocat", "dvwa", ["sqli-low"]), null)).status, 401);
  assert.equal((await post(solve("octocat", "dvwa", ["sqli-low"]), "Bearer wrong")).status, 401);
  assert.equal((await post(solve("octocat", "dvwa", ["sqli-low"]))).status, 202);
});

test("POST validation: 400 on bad author, bad target, bad solved, broken JSON", async (t) => {
  const { post } = await boot(t);
  assert.equal((await post(solve("a:b", "dvwa", []))).status, 400); // key-injection grammar
  assert.equal((await post(solve("-octocat", "dvwa", []))).status, 400);
  assert.equal((await post(solve("octocat", "webgoat", []))).status, 400); // not in rubric
  assert.equal((await post(solve("octocat", "DVWA!", []))).status, 400); // charset
  assert.equal((await post(solve("octocat", "dvwa", "sqli-low"))).status, 400); // non-array
  assert.equal((await post(solve("octocat", "dvwa", [1]))).status, 400); // non-string entry
  assert.equal((await post(`{"author":`)).status, 400); // broken JSON
  assert.equal((await post(solve("octocat[bot]", "dvwa", []))).status, 202); // bot suffix OK
});

test("POST /score rejects bodies over 64 KiB with 413 (authed callers, defense-in-depth)", async (t) => {
  const { post, board } = await boot(t);
  // Valid auth, oversized JSON body: one giant string inside a real payload.
  const big = JSON.stringify(solve("octocat", "dvwa", ["x".repeat(80 * 1024)]));
  const res = await post(big);
  assert.equal(res.status, 413);
  // Nothing was recorded and a normal-size request still works afterwards.
  assert.deepEqual(await board(), { leaderboard: [] });
  assert.equal((await post(solve("octocat", "dvwa", ["sqli-low"]))).status, 202);
});

test("unknown challenge ids are dropped silently, request still 202s", async (t) => {
  const { post, board } = await boot(t);
  const res = await post(solve("octocat", "dvwa", ["sqli-low", "not-in-rubric"]));
  assert.equal(res.status, 202);
  const { leaderboard } = await board();
  assert.equal(leaderboard.length, 1);
  assert.equal(leaderboard[0].points, 1);
  assert.deepEqual(leaderboard[0].apps.dvwa, { solved: 1, total: 1 });
});

test("monotonic: replaying a solve changes neither points nor lastSolveAt", async (t) => {
  const { post, board } = await boot(t);
  await post(solve("octocat", "dvwa", ["sqli-low"])); // T[0]
  const first = await board();
  await post(solve("octocat", "dvwa", ["sqli-low"])); // replay at T[1]
  const second = await board();
  assert.equal(first.leaderboard[0].lastSolveAt, T[0]);
  assert.deepEqual(second, first);
});

test("leaderboard pins the full lambda.ts contract shape", async (t) => {
  const { post, board } = await boot(t);
  await post(solve("alice", "juice-shop", ["reflected-xss-search", "sql-injection-login"])); // T[0]
  await post(solve("alice", "dvwa", ["sqli-low"])); // T[1]
  await post(solve("bob", "juice-shop", ["sql-injection-login"])); // T[2]
  assert.deepEqual(await board(), {
    leaderboard: [
      {
        rank: 1,
        author: "alice",
        points: 16,
        lastSolveAt: T[1],
        apps: {
          dvwa: { solved: 1, total: 1 },
          "juice-shop": { solved: 2, total: 2 },
        },
      },
      {
        rank: 2,
        author: "bob",
        points: 5,
        lastSolveAt: T[2],
        apps: {
          dvwa: { solved: 0, total: 1 },
          "juice-shop": { solved: 1, total: 2 },
        },
      },
    ],
  });
});

test("ties break by earlier lastSolveAt, then author asc", async (t) => {
  const now = clock([T[0], T[1], T[2], T[2]]);
  const { post, board } = await boot(t, { rubric: null, now });
  // All four score 1 point; zed solves before abe, alpha and zeta tie exactly.
  await post(solve("zed", "app", ["a"])); // T[0]
  await post(solve("abe", "app", ["b"])); // T[1]
  await post(solve("zeta", "app", ["c"])); // T[2]
  await post(solve("alpha", "app", ["d"])); // T[2]
  const { leaderboard } = await board();
  assert.deepEqual(
    leaderboard.map((e) => [e.rank, e.author]),
    [
      [1, "zed"], // earliest solve wins the points tie despite author order
      [2, "abe"],
      [3, "alpha"], // exact-timestamp tie: author asc
      [4, "zeta"],
    ],
  );
});

test("POST /score returns 503 while the store reports paused", async (t) => {
  const store = createMemoryStore();
  store.__setPaused(true);
  const server = await startServer({ rubric: RUBRIC, store, token: TOKEN, now: clock() });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/score`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(solve("octocat", "dvwa", ["sqli-low"])),
  });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "scoring is paused" });
  const board = await (await fetch(`${base}/leaderboard`)).json();
  assert.deepEqual(board, { leaderboard: [] }); // nothing was recorded
});

test("POST /score records normally when the store is not paused", async (t) => {
  const { post, board } = await boot(t); // fresh memory store defaults to unpaused
  assert.equal((await post(solve("octocat", "dvwa", ["sqli-low"]))).status, 202);
  assert.equal((await board()).leaderboard.length, 1);
});

test("no-rubric degenerate mode: 1 point per solve, totals from distinct ids seen", async (t) => {
  const { post, board } = await boot(t, { rubric: null });
  assert.equal((await post(solve("octocat", "anything-goes", ["a", "b"]))).status, 202);
  assert.equal((await post(solve("hubot", "anything-goes", ["b", "c", "Bad_Id"]))).status, 202);
  assert.equal((await post(solve("octocat", "Bad_Target", ["a"]))).status, 400); // charset still applies
  assert.deepEqual(await board(), {
    leaderboard: [
      {
        rank: 1,
        author: "octocat",
        points: 2,
        lastSolveAt: T[0],
        apps: { "anything-goes": { solved: 2, total: 3 } },
      },
      {
        rank: 2,
        author: "hubot",
        points: 2,
        lastSolveAt: T[1],
        apps: { "anything-goes": { solved: 2, total: 3 } },
      },
    ],
  });
});
