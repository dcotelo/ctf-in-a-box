import { createServer } from "node:http";
import { loadRubric } from "./rubric.js";
import { createMemoryStore, createRedisStore } from "./store.js";

// Mirrors sync/src/parse.js — same grammar, because the author becomes a
// Redis field segment (`<author>:<challengeId>`) in the solves hash.
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/;
// Targets and challenge ids share the rubric charset (Redis key/field segments).
const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createHandler({ rubric = null, store, token, now = () => new Date().toISOString() }) {
  if (!token) throw new Error("refusing to start: set CTF_SCORE_BEARER_TOKEN or SCORER_TOKEN");
  // Without a rubric the board can only cover targets this process has seen
  // solves for — degenerate, but honest.
  const seenTargets = new Set();
  const targetsInPlay = () => (rubric ? [...rubric.targets.keys()] : [...seenTargets].sort());

  async function score(req, res) {
    if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: "unauthorized" });
    let body = "";
    for await (const chunk of req) body += chunk;
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return json(res, 400, { error: "body must be JSON" });
    }
    const { author, target, solved } = data ?? {};
    if (typeof author !== "string" || !GITHUB_LOGIN.test(author)) return json(res, 400, { error: "invalid author" });
    if (typeof target !== "string" || !SEGMENT.test(target)) return json(res, 400, { error: "invalid target" });
    if (rubric && !rubric.targets.has(target)) return json(res, 400, { error: `unknown target: ${target}` });
    if (!Array.isArray(solved) || solved.some((s) => typeof s !== "string")) {
      return json(res, 400, { error: "solved must be an array of strings" });
    }
    // Unknown ids are dropped, not fatal — a stale CI rubric must not lose the
    // rest of the batch. Without a rubric only the charset gate applies.
    const ids = [...new Set(solved)].filter((id) =>
      rubric ? rubric.pointsFor(target, id) !== undefined : SEGMENT.test(id),
    );
    await store.recordSolves(target, author, ids, now());
    if (!rubric) seenTargets.add(target);
    res.writeHead(202).end();
  }

  return async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/score") return await score(req, res);
      if (req.method === "GET" && req.url.split("?")[0] === "/leaderboard") {
        return json(res, 200, { leaderboard: await buildLeaderboard({ store, rubric, targets: targetsInPlay() }) });
      }
      if (req.method === "GET" && req.url === "/healthz") return json(res, 200, { ok: true });
      res.writeHead(404).end();
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: err.message });
    }
  };
}

// Earlier solve wins ties; an author with no counted solves sorts last.
function compareLastSolve(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

// Aggregates the solves hashes into the exact GET /leaderboard shape the app's
// lambda source parses (apps/web/src/lib/leaderboard/lambda.ts):
// { leaderboard: [{ rank, author, points, lastSolveAt, apps: { <target>:
//   { solved, total } } }] }. With a rubric, points and totals come from it and
// foreign ids (not in the rubric) are skipped so solved never exceeds total;
// without one, every solve is 1 point and a target's total is the count of
// distinct solved ids seen for it across all authors.
export async function buildLeaderboard({ store, rubric, targets }) {
  const authors = new Map(); // author -> { points, lastSolveAt, perTarget: Map }
  const totals = new Map(); // target -> total challenge count
  for (const target of targets) {
    const solves = await store.getSolves(target);
    const known = rubric?.targets.get(target);
    const distinct = new Set();
    for (const [field, at] of Object.entries(solves)) {
      const i = field.indexOf(":");
      if (i < 1) continue;
      const author = field.slice(0, i);
      const id = field.slice(i + 1);
      const points = known ? known.points.get(id) : 1;
      if (points === undefined) continue;
      distinct.add(id);
      let a = authors.get(author);
      if (!a) authors.set(author, (a = { points: 0, lastSolveAt: null, perTarget: new Map() }));
      a.points += points;
      if (a.lastSolveAt === null || at > a.lastSolveAt) a.lastSolveAt = at;
      a.perTarget.set(target, (a.perTarget.get(target) ?? 0) + 1);
    }
    totals.set(target, known ? known.challenges.length : distinct.size);
  }

  const entries = [...authors.entries()].map(([author, a]) => ({
    author,
    points: a.points,
    lastSolveAt: a.lastSolveAt,
    apps: Object.fromEntries(
      targets.map((t) => [t, { solved: a.perTarget.get(t) ?? 0, total: totals.get(t) }]),
    ),
  }));
  entries.sort(
    (x, y) =>
      y.points - x.points ||
      compareLastSolve(x.lastSolveAt, y.lastSolveAt) ||
      (x.author < y.author ? -1 : x.author > y.author ? 1 : 0),
  );
  return entries.map((e, i) => ({ rank: i + 1, ...e }));
}

export function startServer({ port = 0, ...opts }) {
  const server = createServer(createHandler(opts));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

export async function serve(env = process.env) {
  const token = env.CTF_SCORE_BEARER_TOKEN ?? env.SCORER_TOKEN;
  if (!token) throw new Error("refusing to start: set CTF_SCORE_BEARER_TOKEN or SCORER_TOKEN");
  const rubric = loadRubric(env.RUBRIC_DIR);
  const useRedis = Boolean(env.UPSTASH_REDIS_REST_URL);
  const store = useRedis ? createRedisStore() : createMemoryStore();
  const server = await startServer({ rubric, store, token, port: Number(env.PORT ?? 4000) });
  console.error(
    `ctf-score-engine: serving on :${server.address().port} ` +
      `(${rubric ? `${rubric.targets.size} rubric target(s)` : "no rubric — degenerate mode"}, ` +
      `${useRedis ? "redis" : "memory"} store)`,
  );
  return server;
}
