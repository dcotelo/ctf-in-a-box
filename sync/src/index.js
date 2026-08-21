import { loadConfig, REPO_NAMES } from "./config.js";
import { fetchNewScoreComments } from "./github.js";
import { hasScoreMarker, parseScoreComment } from "./parse.js";
import { submitScore } from "./submit.js";
import { loadState, markSeen, repoState, saveState, seenKey } from "./state.js";
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

/**
 * One tick's disposition of one repo's bot comments. Every comment the loop
 * consumes lands in exactly one bucket, and the buckets exist because BOTH of
 * the scoring bugs this event hit had the same shape: a comment was consumed,
 * no score was submitted, and nothing was written down. A `continue` that
 * precedes every logged branch is invisible by construction — no amount of
 * tailing the poller's logs would have found either one.
 *
 * The buckets are not equally interesting, which is the point of separating
 * them:
 *
 *   - `duplicate` / `noMarker` are ROUTINE. `since` is inclusive, so the
 *     boundary comment is re-read on most ticks, and the workflow's
 *     placeholder legitimately carries no score. Counting them without
 *     distinguishing them is what would make a "dropped" figure permanently
 *     nonzero — and a counter that is always nonzero is a counter nobody
 *     reads.
 *   - `invalid` / `rejected` are NOT routine. Each one is a score that
 *     existed on a PR and will never reach the leaderboard without a human.
 *     These two are what `state.dropped` counts and what /admin shows.
 *   - `retried` is a submission that failed transiently and was deliberately
 *     un-marked; the next tick re-presents it. Worth logging, not worth
 *     counting as lost.
 */
const freshTally = () => ({ ingested: 0, duplicate: 0, noMarker: 0, invalid: 0, rejected: 0, retried: 0 });

/** The tally as a log line, listing only what actually happened. Returns null
 *  when the tick was routine (nothing at all, or only the expected boundary
 *  re-read), so a quiet poller stays quiet and any line it does print means
 *  something. */
function summarize(repo, tally) {
  if (tally.noMarker + tally.invalid + tally.rejected + tally.retried === 0) return null;
  const parts = Object.entries(tally)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${n} ${name}`);
  return `poll ${repo}: ${parts.join(", ")}`;
}

export async function tick(cfg, state, deps = {}) {
  const { fetchImpl = fetch, log = console.error, redis = null } = deps;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  state.ingested ??= 0;
  state.dropped ??= 0;

  // A drop is worth a counter AND a description: "3 dropped" tells an
  // organizer something is wrong, `lastDrop` tells them where to look.
  const drop = (why) => {
    state.dropped++;
    state.lastDrop = why;
    state.lastDropAt = nowIso();
    log(why);
  };

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
      dropped: state.dropped,
      lastDrop: state.lastDrop ?? null,
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
    const tally = freshTally();
    for (const c of result.comments) {
      // Keyed on the comment REVISION, not its id — the workflow upserts one
      // comment per target, so the id alone made a re-scored PR unreachable.
      if (!markSeen(rs, c.id, c.updated_at)) {
        tally.duplicate++;
        continue;
      }
      const payload = parseScoreComment(c.body, cfg);
      if (!payload) {
        // A marker that is PRESENT and unusable is a real loss — the workflow
        // meant to report a score and the poller cannot read it. A comment
        // with no marker is just a comment.
        if (hasScoreMarker(c.body)) {
          tally.invalid++;
          drop(`submit ${repo}: comment ${c.id} carries an unusable ctf-score marker, dropped`);
        } else {
          tally.noMarker++;
        }
        continue;
      }
      try {
        const ok = await submitScore(cfg, payload, fetchImpl);
        if (ok) {
          state.ingested++;
          tally.ingested++;
        } else {
          tally.rejected++;
          drop(`submit ${repo}#${payload.pr}: rejected (4xx), dropped`);
        }
      } catch (err) {
        // Retry next tick: drop THIS revision's key, not every key sharing
        // the comment's id.
        rs.seen = rs.seen.filter((k) => k !== seenKey(c.id, c.updated_at));
        stopAt ??= c.updated_at; // record first failure's timestamp
        lastError = err.message;
        tally.retried++;
        log(`submit ${repo}#${payload.pr}: ${err.message}`);
      }
    }
    const summary = summarize(repo, tally);
    if (summary) log(summary);
    // advance cursor to first failure or to full batch, reset etag if any failure
    rs.since = stopAt ?? result.cursor.since;
    rs.etag = stopAt ? null : result.cursor.etag;
  }

  if (redis) {
    await writeStatusSafely(redis, log, {
      lastPollAt: nowIso(),
      ingested: state.ingested,
      dropped: state.dropped,
      lastDrop: state.lastDrop ?? null,
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
