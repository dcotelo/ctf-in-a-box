import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Exec-probe runner: score a challenge by running its node:test file in a child
// process and reading the reporter output. Ported from the upstream reference
// engine (dc34 .github/actions/ctf-score/src/score.ts). Every non-obvious
// behaviour below is load-bearing — see the comments before changing any of it.

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The child never colours a piped stdout today, but a reporter change should not
// silently break the markers below.
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Whole-file completion marker. The spec reporter withholds the duration summary
// until the child is about to exit, so a child held open by a keep-alive socket
// never emits it — which is exactly why keyed runs prefer the per-test line.
const SUMMARY_MARKER = /\bduration_ms\b/;

// How many bare timeouts (with nothing having reported yet) to tolerate before
// declaring the target unreachable. Two distinguishes a systemic reachability
// failure from one genuinely slow challenge, capping waste at ~2 × safety.
const UNREACHABLE_ABORT_THRESHOLD = 2;

function safetyTimeoutMs(env) {
  const raw = Number(env.CTF_SCORE_SAFETY_MS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 30_000;
}

function resolveConcurrency(itemCount, requested, env) {
  const override = Number(env.CTF_SCORE_CONCURRENCY);
  const base = Number.isFinite(override) && override >= 1 ? Math.floor(override) : requested;
  const c = Number.isFinite(base) && base >= 1 ? Math.floor(base) : 1;
  return Math.max(1, Math.min(c, Math.max(1, itemCount)));
}

// Bounded worker pool preserving input order (results[i] <-> items[i]).
async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, runner));
  return results;
}

// Spawn one `node --test` child, resolving with its combined output. The child
// is killed as soon as isDone(output) is true rather than waited on, so a
// lingering keep-alive socket cannot stall the run; the safety SIGKILL bounds a
// child that never reports at all.
function runChild(args, env, isDone) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env });
    let buf = "";
    let settled = false;
    let done = false;
    let safetyFired = false;
    let hardKill;

    const safety = setTimeout(() => {
      safetyFired = true;
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }, safetyTimeoutMs(env));

    const maybeKill = () => {
      if (done || !isDone(buf)) return;
      done = true;
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
      // Escalate if the graceful signal is ignored (open TLS sockets delay exit).
      hardKill = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }, 2_000);
    };

    child.stdout.on("data", (d) => { buf += d.toString(); maybeKill(); });
    child.stderr.on("data", (d) => { buf += d.toString(); });

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      if (hardKill) clearTimeout(hardKill);
      resolve({ output: buf, bareTimeout: safetyFired && !done });
    };
    child.on("close", finish);
    child.on("error", finish);
  });
}

function scoreOne(challenge, abort, env) {
  const { file, key, byName, testsDir } = challenge.exec;
  const testPath = join(testsDir, file);
  if (!existsSync(testPath)) return Promise.resolve(false);
  // The target already proved unreachable — don't spawn, don't wait.
  if (abort.aborted) return Promise.resolve(false);

  // Deliberately NO --test-force-exit. WebGoat's rubric registers assignments
  // with top-level `await test(...)`; force-exit tears the child down before the
  // HTTP request runs, failing every test regardless of patch state.
  const baseArgs = ["--test", "--test-reporter=spec"];
  const keyed = byName && key ? key : null;
  const args = keyed
    ? [...baseArgs, `--test-name-pattern=^${escapeRegExp(keyed)}$`, testPath]
    : [...baseArgs, testPath];

  const passLine = keyed ? new RegExp(`✔\\s+${escapeRegExp(keyed)}\\b`) : null;
  const failLine = keyed ? new RegExp(`✖\\s+${escapeRegExp(keyed)}\\b`) : null;

  const isDone = (buf) => {
    const c = stripAnsi(buf);
    if (passLine && failLine && (passLine.test(c) || failLine.test(c))) return true;
    return SUMMARY_MARKER.test(c);
  };

  // Strip the runner's own context vars so the child does not mistake this for a
  // recursive test invocation when runExec is itself called from a test.
  const { NODE_TEST_CONTEXT: _ctx, NODE_TEST_WORKER_ID: _wid, ...childEnv } = env;

  return runChild(args, childEnv, isDone).then(({ output, bareTimeout }) => {
    if (bareTimeout) {
      // If anything has already reported, the app is proven reachable: this is
      // one slow challenge, not a dead target. Score it open and leave the
      // abort disarmed so slow challenges cannot zero out the rest.
      if (abort.anyReported) return false;
      abort.bareTimeouts += 1;
      if (abort.bareTimeouts >= UNREACHABLE_ABORT_THRESHOLD) abort.aborted = true;
      return false;
    }

    const clean = stripAnsi(output);
    let patched;
    if (keyed) {
      // The subtest must have actually run and passed. A zero-match pattern
      // produces neither line, so it stays unpatched.
      patched = passLine.test(clean) && !failLine.test(clean);
    } else {
      const num = (re) => {
        const m = clean.match(re);
        return m ? Number(m[1]) : NaN;
      };
      const passN = num(/^[^\n]*\bpass (\d+)\s*$/m);
      const failN = num(/^[^\n]*\bfail (\d+)\s*$/m);
      patched = Number.isFinite(failN) && failN === 0 && passN >= 1;
    }

    abort.anyReported = true;
    return patched;
  });
}

/**
 * Run every challenge's test in isolation and return the solved ids in input order.
 *
 * @param {Array} challenges  challenge objects carrying an `exec` descriptor
 * @param {object} opts
 * @param {number} opts.concurrency  target default; CTF_SCORE_CONCURRENCY overrides
 * @param {object} opts.env          process env forwarded to children
 */
export async function runExec(challenges, { concurrency = 1, env = process.env } = {}) {
  const abort = { bareTimeouts: 0, aborted: false, anyReported: false };
  const outcomes = await runPool(
    challenges,
    (c) => scoreOne(c, abort, env),
    resolveConcurrency(challenges.length, concurrency, env),
  );
  return challenges.filter((_, i) => outcomes[i]).map((c) => c.id);
}
