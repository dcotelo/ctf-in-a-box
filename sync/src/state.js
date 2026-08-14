import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SEEN_CAP = 500;

export function loadState(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { repos: {} };
  }
}

export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, path);
}

export function repoState(state, repo) {
  return (state.repos[repo] ??= { since: null, etag: null, seen: [] });
}

export function markSeen(rs, id) {
  if (rs.seen.includes(id)) return false;
  rs.seen.push(id);
  if (rs.seen.length > SEEN_CAP) rs.seen.splice(0, rs.seen.length - SEEN_CAP);
  return true;
}
