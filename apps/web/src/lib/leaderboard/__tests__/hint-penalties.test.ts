// Unit tests for the hint-penalty overlay: penalties subtract from points
// (floored at 0), entries re-rank, and every no-op/degrade path leaves the
// source data untouched.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardData, LeaderboardEntry } from "../types";

const mocks = vi.hoisted(() => ({
  getHintPenalties: vi.fn<() => Promise<Map<string, number>>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/hint-store", () => ({
  getHintPenalties: mocks.getHintPenalties,
  HINTS_ENABLED: true,
}));

import { withHintPenalties } from "../hint-penalties";

function entry(login: string, points: number, lastSolveAt?: string): LeaderboardEntry {
  return { rank: 0, login, team: null, points, patched: 0, failed: 0, total: 0, apps: {}, updatedAt: null, lastSolveAt };
}

function data(entries: LeaderboardEntry[]): LeaderboardData {
  return {
    entries: entries.map((e, i) => ({ ...e, rank: i + 1 })),
    teams: [],
    generatedAt: "2026-07-13T00:00:00.000Z",
    capabilities: { apps: false, teams: false, challenges: false },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withHintPenalties", () => {
  it("subtracts penalties and re-ranks the affected entries", async () => {
    mocks.getHintPenalties.mockResolvedValueOnce(new Map([["ada", 70]]));
    const result = await withHintPenalties(data([entry("ada", 100), entry("bob", 40)]));
    expect(result.entries.map((e) => [e.login, e.points, e.rank])).toEqual([
      ["bob", 40, 1],
      ["ada", 30, 2],
    ]);
  });

  it("floors a penalized score at 0 instead of going negative", async () => {
    mocks.getHintPenalties.mockResolvedValueOnce(new Map([["newbie", 30]]));
    const result = await withHintPenalties(data([entry("ada", 10), entry("newbie", 20)]));
    const newbie = result.entries.find((e) => e.login === "newbie")!;
    expect(newbie.points).toBe(0);
    expect(newbie.hintPenalty).toBe(30);
  });

  it("marks only penalized entries with hintPenalty", async () => {
    mocks.getHintPenalties.mockResolvedValueOnce(new Map([["bob", 10]]));
    const result = await withHintPenalties(data([entry("ada", 100), entry("bob", 40)]));
    expect(result.entries.find((e) => e.login === "ada")!.hintPenalty).toBeUndefined();
    expect(result.entries.find((e) => e.login === "bob")!.hintPenalty).toBe(10);
  });

  it("breaks a penalty-created point tie by earlier lastSolveAt", async () => {
    mocks.getHintPenalties.mockResolvedValueOnce(new Map([["ada", 10]]));
    // ada drops from 50 to 40, tying bob — but ada's last solve is later, so
    // bob (who reached 40 first) takes the higher rank despite source order.
    const result = await withHintPenalties(
      data([entry("ada", 50, "2026-08-07T15:00:00Z"), entry("bob", 40, "2026-08-07T12:00:00Z")]),
    );
    expect(result.entries.map((e) => [e.login, e.rank])).toEqual([
      ["bob", 1],
      ["ada", 2],
    ]);
  });

  it("keeps the source order on point ties (stable re-rank)", async () => {
    mocks.getHintPenalties.mockResolvedValueOnce(new Map([["ada", 10]]));
    // ada drops from 50 to 40, tying bob — ada came first in the source, so
    // she keeps the higher rank.
    const result = await withHintPenalties(data([entry("ada", 50), entry("bob", 40), entry("cyd", 40)]));
    expect(result.entries.map((e) => e.login)).toEqual(["ada", "bob", "cyd"]);
  });

  it("no-ops when nobody has bought hints", async () => {
    mocks.getHintPenalties.mockResolvedValueOnce(new Map());
    const base = data([entry("ada", 100)]);
    expect(await withHintPenalties(base)).toBe(base);
  });

  it("degrades to the penalty-free view when Upstash is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getHintPenalties.mockRejectedValueOnce(new Error("upstash down"));
    const base = data([entry("ada", 100)]);
    expect(await withHintPenalties(base)).toBe(base);
    consoleError.mockRestore();
  });
});
