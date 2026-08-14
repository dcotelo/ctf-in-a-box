// Unit tests for the team-standings overlay: team points are the sum of
// member points, entries get their team chip, and every no-op/degrade path
// leaves the source data untouched.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardData, LeaderboardEntry } from "../types";

const mocks = vi.hoisted(() => ({
  listTeams: vi.fn<() => Promise<{ slug: string; name: string; members: string[] }[]>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/team-store", () => ({ listTeams: mocks.listTeams }));

import { withTeamStandings } from "../team-standings";

function entry(login: string, points: number): LeaderboardEntry {
  return { rank: 0, login, team: null, points, patched: 0, failed: 0, total: 0, apps: {}, updatedAt: null };
}

function data(overrides: Partial<LeaderboardData> = {}): LeaderboardData {
  return {
    entries: [entry("ada", 100), entry("bob", 40), entry("cyd", 25)],
    teams: [],
    generatedAt: "2026-07-07T00:00:00.000Z",
    capabilities: { apps: true, teams: false, challenges: false },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withTeamStandings", () => {
  it("sums member points into ranked team standings", async () => {
    mocks.listTeams.mockResolvedValueOnce([
      { slug: "red", name: "Red Team", members: ["bob", "cyd"] }, // 65
      { slug: "blue", name: "Blue Team", members: ["ada"] }, // 100
    ]);
    const result = await withTeamStandings(data());
    expect(result.teams).toEqual([
      { rank: 1, slug: "blue", name: "Blue Team", points: 100, members: ["ada"] },
      { rank: 2, slug: "red", name: "Red Team", points: 65, members: ["bob", "cyd"] },
    ]);
    expect(result.capabilities.teams).toBe(true);
  });

  it("attaches the team slug to member entries and leaves solo players alone", async () => {
    mocks.listTeams.mockResolvedValueOnce([{ slug: "red", name: "Red Team", members: ["bob"] }]);
    const result = await withTeamStandings(data());
    expect(result.entries.map((e) => [e.login, e.team])).toEqual([
      ["ada", null],
      ["bob", "red"],
      ["cyd", null],
    ]);
  });

  it("counts members without leaderboard entries as 0 points", async () => {
    mocks.listTeams.mockResolvedValueOnce([
      { slug: "red", name: "Red Team", members: ["bob", "no-prs-yet"] },
    ]);
    const result = await withTeamStandings(data());
    expect(result.teams[0].points).toBe(40);
  });

  it("breaks point ties by name", async () => {
    mocks.listTeams.mockResolvedValueOnce([
      { slug: "z", name: "Zulu", members: ["bob"] }, // 40
      { slug: "a", name: "Alfa", members: ["cyd", "no-prs"] }, // 25... make equal
    ]);
    const base = data({ entries: [entry("bob", 40), entry("cyd", 40)] });
    const result = await withTeamStandings(base);
    expect(result.teams.map((t) => t.name)).toEqual(["Alfa", "Zulu"]);
  });

  it("no-ops when the source already provides teams (mock)", async () => {
    const base = data({ capabilities: { apps: true, teams: true, challenges: true } });
    const result = await withTeamStandings(base);
    expect(result).toBe(base);
    expect(mocks.listTeams).not.toHaveBeenCalled();
  });

  it("no-ops when no teams exist", async () => {
    mocks.listTeams.mockResolvedValueOnce([]);
    const base = data();
    expect(await withTeamStandings(base)).toBe(base);
  });

  it("degrades to the team-less view when Upstash is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listTeams.mockRejectedValueOnce(new Error("upstash down"));
    const base = data();
    expect(await withTeamStandings(base)).toBe(base);
    consoleError.mockRestore();
  });
});
