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

async function main() {
  const cfg = loadConfig();
  const state = loadState(cfg.statePath);
  const redis = makeRedis();
  console.error(`ctf-sync: polling ${cfg.targets.length} repos in ${cfg.org} every ${cfg.pollIntervalMs}ms`);
  for (;;) {
    await tick(cfg, state, { redis });
    saveState(cfg.statePath, state);
    const jitter = cfg.pollIntervalMs * 0.2 * (2 * Math.random() - 1);
    await new Promise((r) => setTimeout(r, cfg.pollIntervalMs + jitter));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`ctf-sync fatal: ${err.message}`);
    process.exit(1);
  });
}
