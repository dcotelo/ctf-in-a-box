import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { loadRubric } from "./rubric.js";
import { validateProbes, runProbes, waitForApp } from "./probe.js";
import { runExec } from "./exec.js";
import { getTarget } from "./targets.js";

// Mirrors sync/src/parse.js — same grammar, because the author becomes a
// Redis field segment (`<author>:<challengeId>`) in the solves hash.
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/;

// Extracts author/pr/sha from a pull_request webhook payload. Every miss is
// its own message — CI logs are the only debugger an organizer gets.
export function readEvent(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`judge: event file not readable: ${path}`);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`judge: event file is not JSON: ${path}`);
  }
  const pull = payload?.pull_request;
  if (!pull) throw new Error(`judge: event has no pull_request payload: ${path}`);
  const author = pull.user?.login;
  if (typeof author !== "string" || author.length === 0) {
    throw new Error("judge: event is missing pull_request.user.login");
  }
  if (!GITHUB_LOGIN.test(author)) {
    throw new Error(`judge: author "${author}" fails the GitHub login grammar (it becomes a Redis key segment)`);
  }
  if (!Number.isInteger(pull.number)) throw new Error("judge: event is missing pull_request.number");
  const sha = pull.head?.sha;
  if (typeof sha !== "string" || sha.length === 0) {
    throw new Error("judge: event is missing pull_request.head.sha");
  }
  return { author, pr: pull.number, sha };
}

// The redacted PR comment. Three pieces are parsed upstream by regex, so
// their exact shape is pinned by test/judge.test.js:
//   score-action title:  /^## 🏆 CTF Patch Score$/m
//   score-action count:  /\*\*(\d+)\s*\/\s*\d+\*\*\s+challenges patched/
//   sync marker:         sync/src/parse.js MARKER + field validation
// Oracle discipline: challenge name + points + ✅/❌ only — never probe
// paths or expected values, so the comment can't be used to game the checks.
export function renderReport({ challenges, solved, author, target, pr, sha }) {
  const done = new Set(solved);
  const marker = `<!-- ctf-score: ${JSON.stringify({ author, target, solved, pr, sha })} -->`;
  return [
    "## 🏆 CTF Patch Score",
    "",
    "| Challenge | Points | Result |",
    "| --- | --- | --- |",
    ...challenges.map((c) => `| ${c.name} | ${c.points} | ${done.has(c.id) ? "✅ Patched" : "❌ Not yet"} |`),
    "",
    `**${solved.length} / ${challenges.length}** challenges patched`,
    "",
    marker,
    "",
  ].join("\n");
}

// Leaderboard push (SCORE_API set). Any failure returns false — the caller
// appends the not-recorded marker and the run still succeeds: the comment
// lands and the action nudges a re-push.
async function postScore(env, body, fetchImpl) {
  try {
    const res = await fetchImpl(`${env.SCORE_API.replace(/\/+$/, "")}/score`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.SCORE_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function judge(env = process.env, { fetchImpl = fetch } = {}) {
  const { TARGET, APP_URL } = env;
  if (!TARGET) throw new Error("judge: TARGET is required");
  if (!APP_URL) throw new Error("judge: APP_URL is required");
  if (env.SCORE_API && !env.SCORE_TOKEN) {
    throw new Error("judge: SCORE_TOKEN is required when SCORE_API is set");
  }

  const rubricDir = env.RUBRIC_DIR ?? "/rubric";
  const rubric = loadRubric(rubricDir);
  if (!rubric) throw new Error(`judge: no rubric found in ${rubricDir}`);
  if (!rubric.targets.has(TARGET)) {
    throw new Error(`judge: target "${TARGET}" is not in the rubric (have: ${[...rubric.targets.keys()].join(", ")})`);
  }
  // The loader passes probes through untouched; the judge validates the whole
  // rubric's grammar here, before touching the network or the event file.
  // Exec challenges carry a test file instead of probes — there is no probe
  // grammar to validate, and their test files are only reachable at run time.
  for (const [target, { challenges }] of rubric.targets) {
    for (const c of challenges) {
      if (!c.exec) validateProbes(c.probes, `${target}/${c.id}`);
    }
  }

  const { author, pr, sha } = readEvent(env.GITHUB_EVENT_PATH ?? "/github/event.json");

  const tries = Number(env.APP_READY_TRIES ?? 60);
  const delayMs = Number(env.APP_READY_DELAY ?? 5) * 1000; // seconds, like the 60×5s default
  if (!(await waitForApp(APP_URL, { tries, delayMs, fetchImpl }))) {
    throw new Error(`judge: ${APP_URL} never became reachable after ${tries} tries`);
  }

  const { challenges } = rubric.targets.get(TARGET);
  let solved;
  if (challenges.some((c) => c.exec)) {
    // Exec rubric: children reach the app through the same APP_URL this process
    // just proved reachable, passed down the target's conventional URL env var
    // as well as APP_URL so a test can read either.
    const urlEnv = getTarget(TARGET)?.urlEnv;
    solved = await runExec(challenges, {
      concurrency: getTarget(TARGET)?.defaultConcurrency ?? 1,
      env: { ...env, ...(urlEnv ? { [urlEnv]: APP_URL } : {}) },
    });
  } else {
    solved = [];
    for (const c of challenges) {
      if (await runProbes(APP_URL, c.probes, { fetchImpl })) solved.push(c.id);
    }
  }

  const reportPath = join(env.GITHUB_WORKSPACE ?? "/github/workspace", "ctf-score.md");
  writeFileSync(reportPath, renderReport({ challenges, solved, author, target: TARGET, pr, sha }));

  if (env.SCORE_API && !(await postScore(env, { author, target: TARGET, solved, pr, sha }, fetchImpl))) {
    appendFileSync(reportPath, "<!-- ctf-score:not-recorded -->\n");
  }

  console.error(`ctf-score-engine: ${TARGET} judged — ${solved.length}/${challenges.length} patched (${reportPath})`);
  return { solved, total: challenges.length, reportPath };
}
