import "server-only";
import { getHintPenalties, HINTS_ENABLED } from "@/lib/hint-store";
import { compareStanding } from "./rank";
import type { LeaderboardData } from "./types";

/**
 * Subtracts each contestant's hint spend (ctf:hints:spent) from their points
 * as a display overlay — the scorer's data is never mutated, so penalties
 * survive re-scores. Scores are floored at 0 and entries are re-ranked.
 *
 * Ordering contract: apply this BEFORE withTeamStandings — team totals are
 * the sum of member points, so summing the already-floored values keeps team
 * standings equal to the sum of the member scores actually displayed.
 *
 * Upstash trouble degrades to the penalty-free view rather than failing the
 * whole leaderboard.
 */
export async function withHintPenalties(data: LeaderboardData): Promise<LeaderboardData> {
  if (!HINTS_ENABLED) return data;

  let penalties: Map<string, number>;
  try {
    penalties = await getHintPenalties();
  } catch (err) {
    console.error("hint penalties unavailable:", err);
    return data;
  }
  if (penalties.size === 0) return data;

  const entries = data.entries
    .map((entry, i) => {
      const penalty = penalties.get(entry.login) ?? 0;
      return {
        // Original position breaks any tie compareStanding can't (equal
        // points and no lastSolveAt), keeping the source order.
        i,
        entry:
          penalty > 0
            ? { ...entry, points: Math.max(0, entry.points - penalty), hintPenalty: penalty }
            : entry,
      };
    })
    .sort((a, b) => compareStanding(a.entry, b.entry) || a.i - b.i)
    .map(({ entry }, i) => ({ ...entry, rank: i + 1 }));

  return { ...data, entries };
}
