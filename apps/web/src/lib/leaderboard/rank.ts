import type { LeaderboardEntry } from "./types";

/** Standing order, most significant first:
 *
 *    1. items completed ACROSS MODULES descending — the board rewards BREADTH
 *       above all else, so clearing more items always outranks clearing fewer
 *       high-value ones. With only secure-development enabled this is exactly
 *       the old `patched` count;
 *    2. total points descending — breaks completion ties on difficulty;
 *    3. earliest activity ascending — whoever reached that score first ranks
 *       higher.
 *
 *  Entries without a parseable activity time sort after those with one, so
 *  remaining ties fall through to the caller's stable ordering. */
export function compareStanding(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return completedCount(b) - completedCount(a) || b.points - a.points || activityMs(a) - activityMs(b);
}

/** Completion across modules, falling back to `patched` for sources that carry
 *  no module data (upstash).
 *
 *  That fallback DOES re-order the upstash board relative to the raw `ZRANGE`
 *  points-descending order it arrives in: a row with more patches but fewer
 *  points now ranks higher. This is deliberate — it makes upstash rank by the
 *  same breadth-first rule as the lambda and mock sources rather than being
 *  the one board scored differently. See `__tests__/rank.test.ts`'s
 *  upstash-shaped case, which pins the resulting order. */
function completedCount(entry: LeaderboardEntry): number {
  const mods = Object.values(entry.modules ?? {});
  if (mods.length === 0) return entry.patched;
  return mods.reduce((n, m) => n + (m?.completed ?? 0), 0);
}

/** An entry's most recent scoring activity: the newest per-module timestamp
 *  (an entry's own "last touched" moment), falling back to `lastSolveAt`.
 *  DO NOT change `Math.max` to `Math.min` — the comparator sorts these
 *  values ASCENDING across entries, so the entry whose most recent activity
 *  is earliest (i.e. stopped changing soonest) wins the tie, which is what
 *  makes "reached that score first ranks higher" hold. Entries with no
 *  parseable timestamp anywhere get `Number.MAX_SAFE_INTEGER` so they still
 *  sort last. */
function activityMs(entry: LeaderboardEntry): number {
  const stamps = Object.values(entry.modules ?? {})
    .map((m) => m?.lastActivityAt)
    .concat(entry.lastSolveAt ?? null)
    .map((iso) => (iso ? Date.parse(iso) : NaN))
    .filter((ms) => Number.isFinite(ms)) as number[];
  return stamps.length > 0 ? Math.max(...stamps) : Number.MAX_SAFE_INTEGER;
}

/** Sorts by standing (source order breaks any remaining ties) and re-stamps
 *  rank 1..n. */
export function rankByStanding(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => compareStanding(a.entry, b.entry) || a.i - b.i)
    .map(({ entry }, i) => ({ ...entry, rank: i + 1 }));
}
