import "server-only";
import type { LeaderboardSource } from "./source";
import type { LeaderboardData, UserProfile } from "./types";
import { buildMockEntries, buildMockTeams, findMockSample } from "./mock-data";

export const mockSource: LeaderboardSource = {
  async getLeaderboard(): Promise<LeaderboardData> {
    const entries = buildMockEntries();
    const teams = buildMockTeams(entries);
    return {
      entries,
      teams,
      generatedAt: new Date().toISOString(),
      capabilities: { apps: true, teams: true, challenges: true },
    };
  },

  async getUser(login: string): Promise<UserProfile | null> {
    if (!findMockSample(login)) return null;
    const entries = buildMockEntries();
    const teams = buildMockTeams(entries);
    const entry = entries.find((e) => e.login === login);
    if (!entry) return null;
    const maxPoints = Object.values(entry.apps).reduce((n, a) => n + (a?.maxPoints ?? 0), 0);
    return {
      login: entry.login,
      team: entry.team,
      teamName: teams.find((t) => t.slug === entry.team)?.name ?? entry.team,
      points: entry.points,
      maxPoints,
      patched: entry.patched,
      failed: entry.failed,
      total: entry.total,
      apps: Object.values(entry.apps).filter(Boolean) as UserProfile["apps"],
      updatedAt: entry.updatedAt,
    };
  },
};
