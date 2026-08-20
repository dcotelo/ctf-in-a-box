import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SEEN_CAP = 500;

/** A plain object — not null, not an array. The only shape `repos` and each
 *  per-repo entry may take. */
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const freshState = () => ({ repos: {} });

/**
 * Reads the cursor/seen-cache state file, repairing anything unusable.
 *
 * The file is JSON this service wrote, so it is tempting to trust its SHAPE
 * once it parses. That was the bug (#63): a partial write, a disk problem or a
 * hand edit during a reset can leave behind valid JSON that is still wrong,
 * and `{}` parses perfectly. The old `catch` only covered read and parse
 * errors, so a bare `{}` sailed through and `repoState` then dereferenced an
 * absent `repos` — on every repo, on every tick.
 *
 * That throw is not contained anywhere: `tick`'s per-repo `try` wraps only the
 * fetch, so the rejection reaches main's fatal handler and exits 1, compose
 * restarts the container, and it reads the same file again. Ingestion stays
 * down for the whole event, which is why this repairs rather than propagates.
 *
 * Repairing is not the same as discarding. Anything still usable is kept —
 * re-zeroing `ingested` would misreport the event's totals, and dropping
 * `resetAt` would make the next tick re-apply a master reset it already
 * performed. Only what is actually broken is replaced.
 *
 * A MISSING file is not a fault: that is every event's first boot, and warning
 * about it would cry wolf. Anything else that had to be repaired is logged,
 * because a silent repair is how a corrupt state file goes unnoticed until the
 * cursor quietly re-reads from scratch.
 */
export function loadState(path, { log = console.error } = {}) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    // ENOENT is the normal first-boot path; anything else (permissions, a
    // directory where the file should be) is worth saying out loud.
    if (err.code !== "ENOENT") log(`ctf-sync: cannot read state at ${path} (${err.message}) — starting fresh`);
    return freshState();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log(`ctf-sync: state at ${path} is not valid JSON (${err.message}) — starting fresh`);
    return freshState();
  }

  if (!isRecord(parsed)) {
    log(`ctf-sync: state at ${path} is not an object — starting fresh`);
    return freshState();
  }

  if (!isRecord(parsed.repos)) {
    log(`ctf-sync: state at ${path} has no usable "repos" — resetting cursors, keeping the rest`);
    parsed.repos = {};
  }

  return parsed;
}

export function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, path);
}

/**
 * The live per-repo slot, created or repaired in place.
 *
 * `loadState` guarantees `repos` on the way in, and `tick` re-establishes it
 * after a master reset — but this is exported, so it re-checks rather than
 * assuming. Same reasoning one level down: a per-repo entry can be damaged
 * independently of its parent, and `markSeen` immediately calls
 * `rs.seen.includes(...)`, so a missing or non-array `seen` is the identical
 * crash one field deeper.
 *
 * Field-by-field, not all-or-nothing: a cursor that survived the damage is
 * worth keeping, because discarding `since` silently re-reads the repo's whole
 * comment history.
 */
export function repoState(state, repo) {
  if (!isRecord(state.repos)) state.repos = {};
  const existing = state.repos[repo];
  if (!isRecord(existing)) return (state.repos[repo] = { since: null, etag: null, seen: [] });
  if (!Array.isArray(existing.seen)) existing.seen = [];
  existing.since ??= null;
  existing.etag ??= null;
  return existing;
}

export function markSeen(rs, id) {
  if (rs.seen.includes(id)) return false;
  rs.seen.push(id);
  if (rs.seen.length > SEEN_CAP) rs.seen.splice(0, rs.seen.length - SEEN_CAP);
  return true;
}
