import "server-only";
import { getHintPenalties, HINTS_AVAILABLE } from "@/lib/hint-store";
import { compareStanding } from "./rank";
import type { LeaderboardData } from "./types";

/**
 * Subtracts hint spend (ctf:hints:spent) from displayed points as an overlay —
 * the scorer's data is never mutated, so penalties survive re-scores. Scores
 * are floored at 0 and both boards are re-ranked.
 *
 * THE PIPELINE'S LAST STAGE, deliberately: the penalty nets the FINAL
 * all-module total. It used to run first, netting scorer points alone —
 * which made hints free in every case where the row's points arrived later:
 * a classic- or quiz-only contestant (row created by module contributions),
 * and upstash-path teams (rows synthesised by team standings). Module blocks
 * everywhere show GROSS module points; the penalty appears exactly once, at
 * the row level, as the −N hints marker.
 *
 * Applies to teams as well as individuals, because the teams view is the
 * DEFAULT board whenever teams exist: leaving team totals unpenalised would
 * make hints effectively free on the primary leaderboard, which is the whole
 * thing the price exists to prevent.
 *
 * A team's penalty is the SUM of its members' spend. Note the deliberate
 * asymmetry with flag scoring: a flag solved by two teammates counts once
 * (the scorer dedupes the union), but a hint bought by two teammates is
 * charged twice — hints are individually purchased, so redundant buying is
 * the team's own coordination cost. Summing also preserves historical
 * pricing, since ctf:hints:spent stores points rather than a count.
 *
 * Note this overlays STANDINGS only, not `series`/`teamSeries`: the chart is
 * a timeline of solve events, not current standing.
 *
 * Upstash trouble degrades to the penalty-free view rather than failing the
 * whole leaderboard.
 */
export async function withHintPenalties(data: LeaderboardData): Promise<LeaderboardData> {
  // Capability only — a deployment with no Upstash credentials skips the call
  // entirely. Whether the organizer has hints ON is decided inside
  // getHintPenalties (via resolveHintConfig), so this cannot disagree with the
  // /admin toggle the way a second env read would.
  if (!HINTS_AVAILABLE) return data;

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

  const teams = data.teams
    .map((team, i) => {
      const penalty = team.members.reduce((sum, m) => sum + (penalties.get(m) ?? 0), 0);
      return {
        i,
        team:
          penalty > 0
            ? { ...team, points: Math.max(0, team.points - penalty), hintPenalty: penalty }
            : team,
      };
    })
    // TeamStanding carries no lastSolveAt, so points decide and the original
    // position (the source's own tie-break) holds any tie.
    .sort((a, b) => b.team.points - a.team.points || a.i - b.i)
    .map(({ team }, i) => ({ ...team, rank: i + 1 }));

  return { ...data, entries, teams };
}
