import "server-only";
import { listTeams } from "@/lib/team-store";
import type { LeaderboardData, TeamStanding } from "./types";

/**
 * Overlays live team standings (from the team store's ctf:team:* records)
 * onto leaderboard data from a source that has no team concept
 * (lambda/upstash). A team's points are the sum of its members' individual
 * points; members with no scored PRs contribute 0. Individual entries get
 * their team slug attached so the row chip renders.
 *
 * No-ops when the source already provides teams (mock), when team writes are
 * disabled, or when no teams exist yet. Upstash trouble degrades to the
 * team-less view rather than failing the whole leaderboard.
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

  const pointsByLogin = new Map(data.entries.map((e) => [e.login, e.points]));
  const standings: TeamStanding[] = teams
    .map((team) => ({
      slug: team.slug,
      name: team.name,
      members: team.members,
      points: team.members.reduce((sum, member) => sum + (pointsByLogin.get(member) ?? 0), 0),
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
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
