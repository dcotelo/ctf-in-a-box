import "server-only";
import { listTeams } from "@/lib/team-store";
import { withTeamClassicPoints, withTeamQuizPoints } from "./module-contributions";
import type { LeaderboardData, TeamStanding } from "./types";

/**
 * Overlays live team MEMBERSHIP (from the team store's ctf:team:* records)
 * onto leaderboard data from a source that has no team concept (upstash, and
 * the empty source a quiz-only event uses). Such a source only has each
 * player's per-login TOTAL, not which flag earned which point — so it has no
 * way to tell whether two teammates' totals overlap on a flag they both
 * solved. Summing member totals into a team score would double-count any such
 * shared flag, so a synthesised row deliberately fabricates no SCORER points:
 * it starts at `points: 0`. Real (deduped) secure-development team points
 * require the scorer/lambda path, which computes them from per-flag data
 * upstream and sets `capabilities.teams = true` before this function ever runs.
 *
 * Module points ARE added to the rows synthesised here, via
 * `withTeamQuizPoints` and `withTeamClassicPoints` — the quiz stores which
 * QUESTION each member answered and classic which CHALLENGE each member
 * solved, so a team's total can be deduped by item (an item three teammates
 * hold counts once) with no per-flag scorer data involved. Leaving them at
 * zero meant a quiz-only (or classic-only) event opened on its DEFAULT view —
 * the teams board, whenever teams exist — with every team tied at nothing
 * while the individual view showed real points. The attribution deliberately
 * lives in `module-contributions.ts` and is merely CALLED from here, so the
 * union rule has exactly one implementation; the pipeline order is unchanged.
 *
 * The two are applied in sequence, each adding only its own module's points
 * and re-ranking on the running total, and each no-ops when its module is
 * disabled — so a single-module event pays for exactly one of them.
 *
 * Membership is matched case-insensitively, like every other login join in
 * this codebase: rows created from module points carry the module store's
 * spelling of the login, and a case disagreement with the team record would
 * otherwise silently drop the team chip.
 *
 * No-ops when the source already provides deduped teams (mock/lambda), when
 * team writes are disabled, or when no teams exist yet. Upstash trouble
 * degrades to the team-less view rather than failing the whole leaderboard.
 */
export async function withTeamStandings(data: LeaderboardData): Promise<LeaderboardData> {
  if (data.capabilities.teams) return data;

  let teams;
  try {
    teams = await listTeams();
  } catch (err) {
    console.error("team standings unavailable:", err);
    return data;
  }
  if (teams.length === 0) return data;

  const teamByLogin = new Map<string, string>();
  for (const team of teams) {
    for (const member of team.members) teamByLogin.set(member.toLowerCase(), team.slug);
  }

  const membershipOnly: TeamStanding[] = teams
    .map((team) => ({
      slug: team.slug,
      name: team.name,
      // team-store's TeamInfo doesn't expose captain yet (listTeams only
      // reads name + members) — default to the first member rather than
      // changing team-store.ts for this.
      captain: team.members[0] ?? "",
      members: team.members,
      // No per-flag data here to dedupe shared flags with — see doc above.
      // Module points are added on top, by question, below.
      points: 0,
    }))
    // Alphabetical is the tie-break, not the order: the module overlays
    // re-rank on the attributed totals and keep this position for teams they
    // cannot separate (and for every team, when no module has points to add).
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team, i) => ({ ...team, rank: i + 1 }));

  const standings = await withTeamClassicPoints(await withTeamQuizPoints(membershipOnly));

  return {
    ...data,
    entries: data.entries.map((entry) => {
      const slug = teamByLogin.get(entry.login.toLowerCase());
      return slug ? { ...entry, team: slug } : entry;
    }),
    teams: standings,
    capabilities: { ...data.capabilities, teams: true },
  };
}
