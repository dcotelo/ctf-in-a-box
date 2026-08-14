import type { LeaderboardEntry } from "./types";

/** Standing order, most significant first:
 *
 *    1. challenges solved (`patched`) descending — the board rewards BREADTH of
 *       solving above all else, so clearing more challenges always outranks
 *       clearing fewer high-value ones;
 *    2. total points descending — breaks solve-count ties on difficulty;
 *    3. lastSolveAt ascending — whoever reached that score first ranks higher.
 *
 *  Entries without a parseable solve time sort after those with one, so
 *  remaining ties fall through to the caller's stable ordering. */
export function compareStanding(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return b.patched - a.patched || b.points - a.points || solveMs(a) - solveMs(b);
}

function solveMs(entry: LeaderboardEntry): number {
  const ms = entry.lastSolveAt ? Date.parse(entry.lastSolveAt) : NaN;
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/** Sorts by standing (source order breaks any remaining ties) and re-stamps
 *  rank 1..n. */
export function rankByStanding(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => compareStanding(a.entry, b.entry) || a.i - b.i)
    .map(({ entry }, i) => ({ ...entry, rank: i + 1 }));
}
