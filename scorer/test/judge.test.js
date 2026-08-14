import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { judge, readEvent, renderReport } from "../src/judge.js";

const RUBRIC_DIR = fileURLToPath(new URL("./fixtures/rubric-judge/", import.meta.url));
const SCORER_DIR = fileURLToPath(new URL("../", import.meta.url));

// ---- Vendored copy of sync/src/parse.js (marker regex + GITHUB_LOGIN grammar
// + field validation). This pins the cross-repo contract: if sync's parser
// changes, this copy AND the judge's marker output must change together. ----
const MARKER = /<!--\s*ctf-score:\s*(\{[\s\S]*?\})\s*-->/;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/;
function parseScoreComment(body, { targets }) {
  const m = MARKER.exec(body ?? "");
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const { author, target, solved } = data;
  if (typeof author !== "string" || !GITHUB_LOGIN.test(author)) return null;
  if (!targets.includes(target)) return null;
  if (!Array.isArray(solved) || solved.some((s) => typeof s !== "string")) return null;
  return {
    author,
    target,
    solved,
    pr: Number(data.pr ?? 0) || 0,
    sha: typeof data.sha === "string" ? data.sha : "",
  };
}
// ---- end vendored copy ----

// score-action's parsing regexes (contract 2 in the spec) — pinned verbatim.
const TITLE_RE = /^## 🏆 CTF Patch Score$/m;
const COUNT_RE = /\*\*(\d+)\s*\/\s*\d+\*\*\s+challenges patched/;
const NOT_RECORDED = "<!-- ctf-score:not-recorded -->";

const EVENT = {
  pull_request: { number: 7, user: { login: "octocat" }, head: { sha: "abc123" } },
};

function writeEvent(payload = EVENT) {
  const path = join(mkdtempSync(join(tmpdir(), "event-")), "event.json");
  writeFileSync(path, JSON.stringify(payload));
  return path;
}

// Mock target app satisfying xss-search + admin-panel but not still-vulnerable.
async function mockApp(t) {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/REDACTED-search") return res.writeHead(200).end("clean results");
    if (path === "/REDACTED-admin" && req.method === "GET") return res.writeHead(401).end();
    if (path === "/REDACTED-admin/login" && req.method === "POST") {
      return res.writeHead(200).end("welcome REDACTED-INCLUDES");
    }
    if (path === "/REDACTED-debug") return res.writeHead(200).end("still here"); // expect 404 → fails
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function baseEnv(t, overrides = {}) {
  return {
    TARGET: "juice-shop",
    APP_URL: await mockApp(t),
    RUBRIC_DIR,
    GITHUB_WORKSPACE: mkdtempSync(join(tmpdir(), "workspace-")),
    GITHUB_EVENT_PATH: writeEvent(),
    APP_READY_TRIES: "3",
    APP_READY_DELAY: "0",
    ...overrides,
  };
}

const report = (env) => readFileSync(join(env.GITHUB_WORKSPACE, "ctf-score.md"), "utf8");

test("poll mode: pinned ctf-score.md format satisfies all three upstream regexes", async (t) => {
  const env = await baseEnv(t);
  const { solved, total } = await judge(env);
  assert.deepEqual(solved, ["xss-search", "admin-panel"]); // rubric order
  assert.equal(total, 3);

  const md = report(env);
  assert.match(md, TITLE_RE); // score-action title rewrite regex
  assert.equal(md.split("\n")[0], "## 🏆 CTF Patch Score"); // verbatim first line
  assert.equal(COUNT_RE.exec(md)?.[1], "2"); // score-action solve-count regex
  assert.match(md, /^<!-- ctf-score: \{.*\} -->$/m); // marker on its own line

  // Marker round-trips through the vendored sync/src/parse.js contract.
  assert.deepEqual(parseScoreComment(md, { targets: ["juice-shop"] }), {
    author: "octocat",
    target: "juice-shop",
    solved: ["xss-search", "admin-panel"],
    pr: 7,
    sha: "abc123",
  });

  // Redacted table: names, points, verdicts — nothing else.
  assert.match(md, /\| Search box no longer reflects HTML \| 10 \| ✅ Patched \|/);
  assert.match(md, /\| Admin panel requires auth \| 5 \| ✅ Patched \|/);
  assert.match(md, /\| Debug endpoint removed \| 1 \| ❌ Not yet \|/);
  assert.ok(!md.includes(NOT_RECORDED)); // no POST attempted in poll mode
});

test("oracle discipline: no probe path or expect string leaks into the report", async (t) => {
  const env = await baseEnv(t);
  await judge(env);
  const md = report(env);
  // Every probe path/header/body/expect value in the fixture carries this sentinel.
  assert.ok(!md.includes("REDACTED"), `report leaked probe detail:\n${md}`);
  // Belt and braces: assert against the fixture source itself.
  for (const line of readFileSync(join(RUBRIC_DIR, "juice-shop.yaml"), "utf8").split("\n")) {
    const m = /(?:path|bodyIncludes|bodyMissing|body):\s*"([^"]+)"/.exec(line);
    if (m) assert.ok(!md.includes(m[1]), `report leaked: ${m[1]}`);
  }
});

test("startup validation: missing TARGET/APP_URL, unknown target, no rubric", async (t) => {
  const env = await baseEnv(t);
  await assert.rejects(judge({ ...env, TARGET: undefined }), /TARGET is required/);
  await assert.rejects(judge({ ...env, APP_URL: undefined }), /APP_URL is required/);
  await assert.rejects(judge({ ...env, TARGET: "webgoat" }), /"webgoat" is not in the rubric/);
  await assert.rejects(judge({ ...env, RUBRIC_DIR: "/no/such/dir" }), /no rubric found/);
});

test("probe grammar is validated at judge startup, before any network call", async (t) => {
  // APP_URL points at a dead port: if validation ran later, we'd see the
  // readiness error instead of the grammar error.
  const env = await baseEnv(t, {
    RUBRIC_DIR: fileURLToPath(new URL("./fixtures/rubric-judge-bad-probe/", import.meta.url)),
    APP_URL: "http://127.0.0.1:1",
    APP_READY_TRIES: "1",
  });
  await assert.rejects(judge(env), /probe juice-shop\/xss-search\[0\]: unknown key: retry/);
});

test("event extraction: happy path and each missing field", async (t) => {
  assert.deepEqual(readEvent(writeEvent()), { author: "octocat", pr: 7, sha: "abc123" });
  assert.throws(() => readEvent("/no/such/event.json"), /event file not readable/);
  const badJson = writeEvent();
  writeFileSync(badJson, "{nope");
  assert.throws(() => readEvent(badJson), /not JSON/);
  assert.throws(() => readEvent(writeEvent({})), /no pull_request/);
  assert.throws(() => readEvent(writeEvent({ pull_request: { number: 7, head: { sha: "abc" } } })), /user\.login/);
  assert.throws(
    () => readEvent(writeEvent({ pull_request: { number: 7, user: { login: "-bad-" }, head: { sha: "abc" } } })),
    /fails the GitHub login grammar/,
  );
  assert.throws(() => readEvent(writeEvent({ pull_request: { user: { login: "octocat" }, head: { sha: "abc" } } })), /pull_request\.number/);
  assert.throws(() => readEvent(writeEvent({ pull_request: { number: 7, user: { login: "octocat" }, head: {} } })), /head\.sha/);
  // And through the judge itself:
  const env = await baseEnv(t, { GITHUB_EVENT_PATH: writeEvent({}) });
  await assert.rejects(judge(env), /no pull_request/);
});

test("readiness: unreachable APP_URL exits 1 through the real CLI", async (t) => {
  const env = await baseEnv(t, { APP_URL: "http://127.0.0.1:1", APP_READY_TRIES: "1", APP_READY_DELAY: "0" });
  await assert.rejects(judge(env), /never became reachable/);
  const { status, stderr } = spawnSync(process.execPath, ["src/index.js", "judge"], {
    cwd: SCORER_DIR,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(status, 1);
  assert.match(stderr, /never became reachable/);
});

test("push mode: 2xx from SCORE_API records the score, no not-recorded marker", async (t) => {
  const { createServer } = await import("node:http");
  const posts = [];
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    posts.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(202).end();
  });
  await new Promise((r) => api.listen(0, r));
  t.after(() => api.close());

  const env = await baseEnv(t, {
    SCORE_API: `http://127.0.0.1:${api.address().port}`,
    SCORE_TOKEN: "push-tok",
  });
  await judge(env);
  assert.deepEqual(posts, [
    {
      url: "/score",
      auth: "Bearer push-tok",
      body: { author: "octocat", target: "juice-shop", solved: ["xss-search", "admin-panel"], pr: 7, sha: "abc123" },
    },
  ]);
  assert.ok(!report(env).includes(NOT_RECORDED));
});

test("push mode: rejected or unreachable SCORE_API appends not-recorded, still succeeds", async (t) => {
  const { createServer } = await import("node:http");
  const api = createServer((req, res) => res.writeHead(500).end());
  await new Promise((r) => api.listen(0, r));
  t.after(() => api.close());

  const rejected = await baseEnv(t, {
    SCORE_API: `http://127.0.0.1:${api.address().port}`,
    SCORE_TOKEN: "push-tok",
  });
  await judge(rejected); // resolves — exit 0 contract
  assert.match(report(rejected), /^<!-- ctf-score:not-recorded -->$/m);
  // The JSON marker still parses even with the failure marker appended after it.
  assert.equal(parseScoreComment(report(rejected), { targets: ["juice-shop"] })?.author, "octocat");

  const unreachable = await baseEnv(t, { SCORE_API: "http://127.0.0.1:1", SCORE_TOKEN: "push-tok" });
  await judge(unreachable);
  assert.match(report(unreachable), /^<!-- ctf-score:not-recorded -->$/m);
});

test("push mode: SCORE_API without SCORE_TOKEN refuses at startup", async (t) => {
  const env = await baseEnv(t, { SCORE_API: "http://127.0.0.1:1" });
  await assert.rejects(judge(env), /SCORE_TOKEN is required when SCORE_API is set/);
});

test("renderReport pins column layout and JSON key order", () => {
  const md = renderReport({
    challenges: [{ id: "a", name: "A", points: 2 }],
    solved: [],
    author: "octocat",
    target: "juice-shop",
    pr: 7,
    sha: "abc123",
  });
  assert.match(md, /\| Challenge \| Points \| Result \|/);
  assert.match(md, /\*\*0 \/ 1\*\* challenges patched/);
  assert.ok(md.includes('<!-- ctf-score: {"author":"octocat","target":"juice-shop","solved":[],"pr":7,"sha":"abc123"} -->'));
});
