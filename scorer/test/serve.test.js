import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadRubric } from "../src/rubric.js";
import { createMemoryStore } from "../src/store.js";
import { createHandler, startServer, buildLeaderboard } from "../src/serve.js";

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
  assert.deepEqual(await board(), { leaderboard: [], series: [], teams: [], teamSeries: [] });
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/score`)).status, 404); // GET /score is not a route
});

test("POST /score requires the exact bearer token", async (t) => {
  const { post } = await boot(t);
  assert.equal((await post(solve("octocat", "dvwa", ["sqli-low"]), null)).status, 401);
  assert.equal((await post(solve("octocat", "dvwa", ["sqli-low"]), "Bearer wrong")).status, 401);
  assert.equal((await post(solve("octocat", "dvwa", ["sqli-low"]))).status, 202);
  // multibyte char: same char-length as TOKEN ("s3cret"=6 chars) but different byte-length
  // "s3cr\u00e9t" is 6 UTF-16 code units but 7 UTF-8 bytes → 401, not 500
  assert.equal((await post(solve("octocat", "dvwa", ["sqli-low"]), "Bearer s3cr\u00e9t")).status, 401);
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
  assert.deepEqual(await board(), { leaderboard: [], series: [], teams: [], teamSeries: [] });
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
    series: [
      {
        login: "alice",
        // Both juice-shop ids land on T[0] (one POST -> one timestamp);
        // "reflected-xss-search" < "sql-injection-login" breaks the tie.
        points: [
          { t: T[0], score: 10 },
          { t: T[0], score: 15 },
          { t: T[1], score: 16 },
        ],
      },
      { login: "bob", points: [{ t: T[2], score: 5 }] },
    ],
    teams: [], // no team data on this store -> empty rollup
    teamSeries: [],
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
  assert.deepEqual(board, { leaderboard: [], series: [], teams: [], teamSeries: [] }); // nothing was recorded
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
    series: [], // no rubric -> no per-challenge points to accumulate
    teams: [],
    teamSeries: [],
  });
});

// buildLeaderboard's `series` field: cumulative score-over-time history for
// the top players, feeding the app's CTFd-style line chart (D2). Exercised
// directly against the store so timestamps and out-of-order writes are fully
// controlled, rather than through the clock-driven HTTP surface above.
test("series: cumulative step series per player, out-of-order writes still sort ascending", async (t) => {
  const store = createMemoryStore();
  // Written out of chronological order: juice-shop (T[1]) is recorded before
  // dvwa (T[0]) — the series must still come out ascending by timestamp.
  await store.recordSolves("juice-shop", "alice", ["reflected-xss-search"], T[1]); // 10 pts
  await store.recordSolves("dvwa", "alice", ["sqli-low"], T[0]); // 1 pt
  await store.recordSolves("juice-shop", "bob", ["sql-injection-login"], T[2]); // 5 pts

  const { entries, series } = await buildLeaderboard({
    store,
    rubric: RUBRIC,
    targets: ["dvwa", "juice-shop"],
  });

  assert.deepEqual(series, [
    {
      login: "alice",
      points: [
        { t: T[0], score: 1 },
        { t: T[1], score: 11 },
      ],
    },
    { login: "bob", points: [{ t: T[2], score: 5 }] },
  ]);
  // Last point of each series matches that player's final leaderboard score.
  for (const s of series) {
    const last = s.points.at(-1).score;
    assert.equal(last, entries.find((e) => e.author === s.login).points);
  }
});

test("series: rubric = null yields no series (no per-challenge points to accumulate)", async (t) => {
  const store = createMemoryStore();
  await store.recordSolves("app", "octocat", ["a"], T[0]);
  const { series } = await buildLeaderboard({ store, rubric: null, targets: ["app"] });
  assert.deepEqual(series, []);
});

test("series: single player, single solve produces one point", async (t) => {
  const store = createMemoryStore();
  await store.recordSolves("dvwa", "solo", ["sqli-low"], T[0]);
  const { series } = await buildLeaderboard({ store, rubric: RUBRIC, targets: ["dvwa", "juice-shop"] });
  assert.deepEqual(series, [{ login: "solo", points: [{ t: T[0], score: 1 }] }]);
});

test("series: capped at the top 10 players by final score", async (t) => {
  const store = createMemoryStore();
  const stamps = Array.from(
    { length: 11 },
    (_, i) => new Date(Date.parse("2026-08-14T09:00:00.000Z") + i * 60_000).toISOString(),
  );
  // 11 players, one solve each, all worth 1 point (dvwa's sqli-low has no
  // explicit `points` -> defaults to 1) — ranking falls back to earliest
  // lastSolveAt, so p0..p9 (earliest 10) make the cut and p10 does not.
  for (let i = 0; i < stamps.length; i++) {
    await store.recordSolves("dvwa", `p${i}`, ["sqli-low"], stamps[i]);
  }
  const { series } = await buildLeaderboard({ store, rubric: RUBRIC, targets: ["dvwa", "juice-shop"] });
  assert.equal(series.length, 10);
  assert.deepEqual(
    series.map((s) => s.login),
    Array.from({ length: 10 }, (_, i) => `p${i}`),
  );
});

// --- Team-aware rollup (A2). buildLeaderboard reads store.getTeams() and adds
// `teams` + `teamSeries` alongside the individual `entries`/`series`, unioning
// each team's members' solves so a flag solved by two members counts once. ---

const teamStore = (teams) => createMemoryStore({ teams });
const TARGETS = ["dvwa", "juice-shop"];

test("team rollup: same flag solved by two members counts once, not doubled", async () => {
  const store = teamStore([{ slug: "red", name: "Red", captain: "alice", members: ["alice", "bob"] }]);
  await store.recordSolves("dvwa", "alice", ["sqli-low"], T[1]);
  await store.recordSolves("dvwa", "bob", ["sqli-low"], T[0]); // same flag, earlier
  const { teams } = await buildLeaderboard({ store, rubric: RUBRIC, targets: TARGETS });
  assert.equal(teams.length, 1);
  assert.equal(teams[0].points, 1); // ONCE, not 2
  assert.equal(teams[0].lastSolveAt, T[0]); // union keeps the MIN at per flag
  assert.deepEqual(teams[0].apps.dvwa, { solved: 1, total: 1 });
});

test("team rollup: disjoint flags sum across members", async () => {
  const store = teamStore([{ slug: "red", name: "Red", captain: "alice", members: ["alice", "bob"] }]);
  await store.recordSolves("juice-shop", "alice", ["reflected-xss-search"], T[0]); // 10
  await store.recordSolves("juice-shop", "bob", ["sql-injection-login"], T[1]); // 5
  const { teams } = await buildLeaderboard({ store, rubric: RUBRIC, targets: TARGETS });
  assert.equal(teams[0].points, 15);
  assert.deepEqual(teams[0].apps["juice-shop"], { solved: 2, total: 2 });
  assert.equal(teams[0].lastSolveAt, T[1]);
});

test("team rollup: a solve recorded for a login before it appears in getTeams still rolls in", async () => {
  // Rollup is by membership at read time, so a historical solve counts
  // retroactively once the login is a member — seed both, then assert.
  const store = teamStore([{ slug: "blue", name: "Blue", captain: "carol", members: ["carol"] }]);
  await store.recordSolves("dvwa", "carol", ["sqli-low"], T[0]);
  const { teams } = await buildLeaderboard({ store, rubric: RUBRIC, targets: TARGETS });
  assert.equal(teams[0].points, 1);
  assert.equal(teams[0].lastSolveAt, T[0]);
});

test("team rollup: a solo team's points equal that member's individual points", async () => {
  const store = teamStore([{ slug: "solo", name: "Solo", captain: "dave", members: ["dave"] }]);
  await store.recordSolves("juice-shop", "dave", ["reflected-xss-search", "sql-injection-login"], T[0]);
  await store.recordSolves("dvwa", "dave", ["sqli-low"], T[1]);
  const { entries, teams } = await buildLeaderboard({ store, rubric: RUBRIC, targets: TARGETS });
  const dave = entries.find((e) => e.author === "dave");
  assert.equal(teams[0].points, dave.points);
  assert.equal(teams[0].points, 16);
  assert.equal(teams[0].lastSolveAt, dave.lastSolveAt);
  assert.deepEqual(teams[0].members, ["dave"]);
  assert.equal(teams[0].captain, "dave");
});

test("teamSeries: cumulative and deduped — a shared flag adds once at the earlier timestamp", async () => {
  const store = teamStore([{ slug: "red", name: "Red", captain: "alice", members: ["alice", "bob"] }]);
  await store.recordSolves("juice-shop", "alice", ["reflected-xss-search"], T[0]); // 10 @ T0
  await store.recordSolves("dvwa", "bob", ["sqli-low"], T[1]); // 1 @ T1
  await store.recordSolves("dvwa", "alice", ["sqli-low"], T[2]); // dup of bob's flag, later
  const { teamSeries, teams } = await buildLeaderboard({ store, rubric: RUBRIC, targets: TARGETS });
  assert.deepEqual(teamSeries, [
    {
      slug: "red",
      name: "Red",
      // sqli-low deduped to its earlier at (T1, bob); union = {xss @T0, sqli @T1}.
      points: [
        { t: T[0], score: 10 },
        { t: T[1], score: 11 },
      ],
    },
  ]);
  assert.equal(teams[0].points, 11); // 10 + 1, shared flag once
});

test("team ranking: equal points break by earlier lastSolveAt", async () => {
  const store = teamStore([
    { slug: "late", name: "Late", captain: "x", members: ["x"] },
    { slug: "early", name: "Early", captain: "y", members: ["y"] },
  ]);
  await store.recordSolves("dvwa", "y", ["sqli-low"], T[0]); // early: 1 @ T0
  await store.recordSolves("dvwa", "x", ["sqli-low"], T[1]); // late: 1 @ T1
  const { teams } = await buildLeaderboard({ store, rubric: RUBRIC, targets: TARGETS });
  assert.deepEqual(
    teams.map((tm) => [tm.rank, tm.slug]),
    [
      [1, "early"], // equal points -> earlier lastSolveAt ranks first
      [2, "late"],
    ],
  );
});

test("team rollup is additive: individual entries/series are unchanged by the team columns", async () => {
  const seed = async (store) => {
    await store.recordSolves("juice-shop", "alice", ["reflected-xss-search"], T[0]);
    await store.recordSolves("dvwa", "bob", ["sqli-low"], T[1]);
  };
  const withTeams = teamStore([{ slug: "red", name: "Red", captain: "alice", members: ["alice", "bob"] }]);
  const without = createMemoryStore();
  await seed(withTeams);
  await seed(without);
  const a = await buildLeaderboard({ store: withTeams, rubric: RUBRIC, targets: TARGETS });
  const b = await buildLeaderboard({ store: without, rubric: RUBRIC, targets: TARGETS });
  assert.deepEqual(a.entries, b.entries);
  assert.deepEqual(a.series, b.series);
  assert.deepEqual(b.teams, []); // no team data -> empty rollup
  assert.deepEqual(b.teamSeries, []);
});

test("teamSeries: empty without a rubric (no per-challenge points to accumulate)", async () => {
  const store = teamStore([{ slug: "red", name: "Red", captain: "alice", members: ["alice"] }]);
  await store.recordSolves("app", "alice", ["a"], T[0]);
  const { teams, teamSeries } = await buildLeaderboard({ store, rubric: null, targets: ["app"] });
  assert.equal(teams[0].points, 1); // degenerate mode: 1 point per solve
  assert.deepEqual(teamSeries, []);
});
