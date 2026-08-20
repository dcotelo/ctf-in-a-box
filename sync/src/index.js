import { loadConfig, REPO_NAMES } from "./config.js";
import { fetchNewScoreComments } from "./github.js";
import { parseScoreComment } from "./parse.js";
import { submitScore } from "./submit.js";
import { loadState, markSeen, repoState, saveState } from "./state.js";
import { makeRedis } from "./redis.js";

// Fail-safe wrapper: a broken deps.redis (whatever its origin) must never
// reject the tick — cursors live in the JSON state file and must be
// unaffected by any Redis problem.
async function writeStatusSafely(redis, log, status) {
  try {
    await redis.writeStatus(status);
  } catch (err) {
    log(`redis writeStatus: ${err.message}`);
  }
}

export async function tick(cfg, state, deps = {}) {
  const { fetchImpl = fetch, log = console.error, redis = null } = deps;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  state.ingested ??= 0;

  // Master-reset epoch, BEFORE the pause check: a reset also freezes scoring,
  // so we must drop the cursor even while paused, or an unfreeze would re-ingest
  // from the cursor's old position. Clearing repos makes the next poll re-read
  // from scratch; the caller persists `state` after this tick.
  if (redis?.getResetAt) {
    const resetAt = await redis.getResetAt();
    if (resetAt && resetAt !== state.resetAt) {
      state.repos = {};
      state.resetAt = resetAt;
    }
  }

  if (redis && (await redis.isPaused())) {
    await writeStatusSafely(redis, log, {
      lastPollAt: nowIso(),
      ingested: state.ingested,
      reposPolled: 0,
      paused: true,
      lastError: null,
    });
    return state;
  }

  let reposPolled = 0;
  let lastError = null;
  for (const target of cfg.targets) {
    reposPolled++;
    const repo = REPO_NAMES[target];
    const rs = repoState(state, repo);
    let result;
    try {
      result = await fetchNewScoreComments(cfg, repo, rs, fetchImpl);
    } catch (err) {
      log(`poll ${repo}: ${err.message}`);
      lastError = err.message;
      continue;
    }
    let stopAt;
    for (const c of result.comments) {
      if (!markSeen(rs, c.id)) continue;
      const payload = parseScoreComment(c.body, cfg);
      if (!payload) continue;
      try {
        const ok = await submitScore(cfg, payload, fetchImpl);
        if (ok) state.ingested++;
        else log(`submit ${repo}#${payload.pr}: rejected (4xx), dropped`);
      } catch (err) {
        rs.seen = rs.seen.filter((id) => id !== c.id); // retry next tick
        stopAt ??= c.updated_at; // record first failure's timestamp
        lastError = err.message;
        log(`submit ${repo}#${payload.pr}: ${err.message}`);
      }
    }
    // advance cursor to first failure or to full batch, reset etag if any failure
    rs.since = stopAt ?? result.cursor.since;
    rs.etag = stopAt ? null : result.cursor.etag;
  }

  if (redis) {
    await writeStatusSafely(redis, log, {
      lastPollAt: nowIso(),
      ingested: state.ingested,
      reposPolled,
      paused: false,
      lastError,
    });
  }
  return state;
}

// Exported for the tests: every collaborator is injectable so main() can be
// exercised WITHOUT a real config file, Redis, GitHub, or an unstoppable poll
// loop. It used to be unreachable from a test — the null-config guard below
// could be deleted with the whole suite still green (49/49), which is no
// guard at all. test/main.test.js now watches it fail.
export async function main(deps = {}) {
  const {
    load = loadConfig,
    log = console.log,
    logErr = console.error,
    readState = loadState,
    writeState = saveState,
    makeRedisImpl = makeRedis,
    runTick = tick,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = deps;

  const cfg = load();
  // No polled module in this event.yaml (a quiz-only event): exit cleanly
  // BEFORE touching state, Redis or the poll loop. Returning here — paired
  // with compose's `restart: on-failure` — is the whole reason the poller
  // stops instead of crash-looping with nothing to poll.
  if (!cfg) {
    log("ctf-sync: no polled module enabled, nothing to do");
    return;
  }

  // `logErr` so a state repair lands in the same stream as the poller's other
  // operational lines — a warning nobody sees is the silent repair this guards
  // against (#63).
  const state = readState(cfg.statePath, { log: logErr });
  const redis = makeRedisImpl();
  logErr(`ctf-sync: polling ${cfg.targets.length} repos in ${cfg.org} every ${cfg.pollIntervalMs}ms`);
  for (;;) {
    await runTick(cfg, state, { redis });
    writeState(cfg.statePath, state);
    const jitter = cfg.pollIntervalMs * 0.2 * (2 * Math.random() - 1);
    await sleep(cfg.pollIntervalMs + jitter);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`ctf-sync fatal: ${err.message}`);
    process.exit(1);
  });
}
