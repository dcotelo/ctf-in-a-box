import { loadConfig, REPO_NAMES } from "./config.js";
import { fetchNewScoreComments } from "./github.js";
import { parseScoreComment } from "./parse.js";
import { submitScore } from "./submit.js";
import { loadState, markSeen, repoState, saveState } from "./state.js";

export async function tick(cfg, state, deps = {}) {
  const { fetchImpl = fetch, log = console.error } = deps;
  for (const target of cfg.targets) {
    const repo = REPO_NAMES[target];
    const rs = repoState(state, repo);
    let result;
    try {
      result = await fetchNewScoreComments(cfg, repo, rs, fetchImpl);
    } catch (err) {
      log(`poll ${repo}: ${err.message}`);
      continue;
    }
    let stopAt;
    for (const c of result.comments) {
      if (!markSeen(rs, c.id)) continue;
      const payload = parseScoreComment(c.body, cfg);
      if (!payload) continue;
      try {
        const ok = await submitScore(cfg, payload, fetchImpl);
        if (!ok) log(`submit ${repo}#${payload.pr}: rejected (4xx), dropped`);
      } catch (err) {
        rs.seen = rs.seen.filter((id) => id !== c.id); // retry next tick
        stopAt ??= c.updated_at; // record first failure's timestamp
        log(`submit ${repo}#${payload.pr}: ${err.message}`);
      }
    }
    // advance cursor to first failure or to full batch, reset etag if any failure
    rs.since = stopAt ?? result.cursor.since;
    rs.etag = stopAt ? null : result.cursor.etag;
  }
  return state;
}

async function main() {
  const cfg = loadConfig();
  const state = loadState(cfg.statePath);
  console.error(`ctf-sync: polling ${cfg.targets.length} repos in ${cfg.org} every ${cfg.pollIntervalMs}ms`);
  for (;;) {
    await tick(cfg, state);
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
