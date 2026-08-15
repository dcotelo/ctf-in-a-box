import "server-only";
import { listTeams } from "@/lib/team-store";
import type { LeaderboardData, TeamStanding } from "./types";

/**
 * Overlays live team MEMBERSHIP (from the team store's ctf:team:* records)
 * onto leaderboard data from a source that has no team concept
 * (upstash). This source only has each player's per-login TOTAL, not which
 * flag earned which point — so it has no way to tell whether two teammates'
 * totals overlap on a flag they both solved. Summing member totals into a
 * team score would double-count any such shared flag, so this deliberately
 * does NOT fabricate a points figure: team rows get `points: 0` and exist
 * only so the row chip renders. Real (deduped) team points require the
 * scorer/lambda path, which computes them from per-flag data upstream and
 * sets `capabilities.teams = true` before this function ever runs.
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
    for (const member of team.members) teamByLogin.set(member, team.slug);
  }

  const standings: TeamStanding[] = teams
    .map((team) => ({
      slug: team.slug,
      name: team.name,
      // team-store's TeamInfo doesn't expose captain yet (listTeams only
      // reads name + members) — default to the first member rather than
      // changing team-store.ts for this.
      captain: team.members[0] ?? "",
      members: team.members,
      // No per-flag data here to dedupe shared flags with — see doc above.
      points: 0,
    }))
    // No real point figure to rank by; alphabetical keeps the order stable.
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team, i) => ({ ...team, rank: i + 1 }));

  return {
    ...data,
    entries: data.entries.map((entry) =>
      teamByLogin.has(entry.login) ? { ...entry, team: teamByLogin.get(entry.login)! } : entry,
    ),
    teams: standings,
    capabilities: { ...data.capabilities, teams: true },
  };
}
