import { describe, expect, it, vi } from "vitest";
import type { LeaderboardData, LeaderboardEntry } from "../types";
import { rankByStanding } from "../rank";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/modules", () => ({
  enabledModules: [{ id: "secure-development", displayName: "Secure Development", description: "", targets: ["dvwa"] }],
  isModuleEnabled: (id: string) => id === "secure-development",
}));

import { withModuleContributions } from "../module-contributions";

const entry = (login: string, points: number, patched: number, lastSolveAt = "2026-08-01T10:00:00.000Z"): LeaderboardEntry => ({
  rank: 0, login, team: null, points, patched, failed: 0, total: 3,
  apps: { dvwa: { app: "dvwa", points, maxPoints: 30, patched, total: 3 } },
  updatedAt: null, lastSolveAt,
});

const data = (entries: LeaderboardEntry[]): LeaderboardData => ({
  entries: entries.map((e, i) => ({ ...e, rank: i + 1 })),
  teams: [],
  generatedAt: "2026-08-01T00:00:00.000Z",
  capabilities: { apps: true, teams: false, challenges: false },
});

describe("withModuleContributions", () => {
  it("attributes the source's points to secure-development without double counting", async () => {
    const out = await withModuleContributions(data([entry("ada", 30, 3)]));
    const mod = out.entries[0].modules!["secure-development"]!;
    expect(out.entries[0].points).toBe(30); // unchanged
    expect(mod).toMatchObject({ points: 30, completed: 3, lastActivityAt: "2026-08-01T10:00:00.000Z" });
    expect(mod.detail).toEqual({ kind: "secure-development", apps: out.entries[0].apps });
  });

  it("re-ranks unconditionally, so ordering never depends on the hint overlay", async () => {
    const out = await withModuleContributions(data([entry("bob", 10, 1), entry("ada", 30, 3)]));
    expect(out.entries.map((e) => [e.login, e.rank])).toEqual([["ada", 1], ["bob", 2]]);
  });

  it("leaves a source with no per-app data alone rather than inventing a module", async () => {
    const bare = { ...entry("ada", 30, 3), apps: {} };
    const out = await withModuleContributions({ ...data([bare]), capabilities: { apps: false, teams: false, challenges: false } });
    expect(out.entries[0].modules).toEqual({});
  });

  it("passes teams through untouched", async () => {
    // Team rows have no per-module renderer yet (phase 2), and on the upstash
    // path withTeamStandings replaces data.teams wholesale anyway.
    const teams = [{ rank: 1, slug: "red", name: "Red", captain: "ada", points: 30, members: ["ada"] }];
    const out = await withModuleContributions({ ...data([entry("ada", 30, 3)]), teams });
    expect(out.teams).toEqual(teams);
  });

  // upstash carries no per-app data and no modules map, so completedCount
  // falls back to `patched` — which DOES re-order the raw ZRANGE
  // points-descending order this source arrives in. Accepted deliberately (it
  // makes upstash rank by the same breadth-first rule as lambda/mock); pinned
  // here so the change can't happen again unnoticed.
  it("re-orders an upstash-shaped board onto the breadth-first rule", async () => {
    const bare = (login: string, points: number, patched: number) => ({
      ...entry(login, points, patched), apps: {},
    });
    const out = await withModuleContributions({
      // ZRANGE order: points descending.
      ...data([bare("hoarder", 90, 1), bare("grinder", 20, 4)]),
      capabilities: { apps: false, teams: false, challenges: false },
    });
    expect(out.entries.map((e) => [e.login, e.rank])).toEqual([["grinder", 1], ["hoarder", 2]]);
    expect(out.entries.every((e) => Object.keys(e.modules ?? {}).length === 0)).toBe(true);
  });

  // Regression gate for the whole project: with only secure-development
  // configured, a populated module (completed === patched, lastActivityAt
  // === lastSolveAt) must rank identically to how rankByStanding already
  // ranked these rows via the patched/lastSolveAt fallback (Task 3), before
  // this overlay existed.
  it("ranks identically to the pre-overlay patched/lastSolveAt fallback", async () => {
    const raw = [
      entry("ada", 30, 3, "2026-08-01T09:00:00.000Z"),
      entry("carol", 30, 3, "2026-08-01T08:00:00.000Z"), // same points/completed, earlier activity
      entry("bob", 10, 1, "2026-08-01T10:00:00.000Z"),
    ];

    const before = rankByStanding(raw).map((e) => [e.login, e.rank]);
    const out = await withModuleContributions(data(raw));

    expect(out.entries.map((e) => [e.login, e.rank])).toEqual(before);

    for (const e of out.entries) {
      const mod = e.modules!["secure-development"]!;
      expect(mod.completed).toBe(e.patched);
      expect(mod.lastActivityAt).toBe(e.lastSolveAt);
    }
  });
});
