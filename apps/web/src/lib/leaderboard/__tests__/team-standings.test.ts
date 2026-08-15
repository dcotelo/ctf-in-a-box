// Unit tests for the team-standings overlay. This is a FALLBACK for sources
// with no per-flag data (upstash) — it cannot dedupe a flag two teammates
// both solved, so it must never sum member totals into a fabricated team
// score (that's the double-count bug this file guards against). It only
// attaches membership so the row chip renders; real team points come from
// the scorer/lambda path, which sets capabilities.teams = true up front and
// is passed through untouched (no-op).

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
  it("does NOT sum member points into a fabricated team score (no per-flag data to dedupe with)", async () => {
    mocks.listTeams.mockResolvedValueOnce([
      { slug: "red", name: "Red Team", members: ["bob", "cyd"] }, // would be 65 if (wrongly) summed
      { slug: "blue", name: "Blue Team", members: ["ada"] }, // would be 100 if (wrongly) summed
    ]);
    const result = await withTeamStandings(data());
    expect(result.teams.map((t) => t.points)).toEqual([0, 0]);
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

  it("defaults captain to the first member (team-store has no captain field yet)", async () => {
    mocks.listTeams.mockResolvedValueOnce([{ slug: "red", name: "Red Team", members: ["bob", "cyd"] }]);
    const result = await withTeamStandings(data());
    expect(result.teams[0].captain).toBe("bob");
    expect(result.teams[0].members).toEqual(["bob", "cyd"]);
  });

  it("ranks teams alphabetically since no real point figure is available", async () => {
    mocks.listTeams.mockResolvedValueOnce([
      { slug: "z", name: "Zulu", members: ["bob"] },
      { slug: "a", name: "Alfa", members: ["cyd"] },
    ]);
    const result = await withTeamStandings(data());
    expect(result.teams.map((t) => t.name)).toEqual(["Alfa", "Zulu"]);
    expect(result.teams.map((t) => t.rank)).toEqual([1, 2]);
  });

  it("no-ops when the source already provides deduped teams (mock/lambda/scorer path)", async () => {
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
