import { describe, expect, it, vi } from "vitest";
import type { LeaderboardData } from "../types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/modules", () => ({
  enabledModules: [{ id: "secure-development", displayName: "Secure Development", description: "", targets: ["dvwa"] }],
  isModuleEnabled: (id: string) => id === "secure-development",
}));
vi.mock("@/lib/hint-store", () => ({ getHintPenalties: async () => new Map(), HINTS_ENABLED: false }));

import { withModuleContributions } from "../module-contributions";
import { withHintPenalties } from "../hint-penalties";

const base: LeaderboardData = {
  entries: [
    { rank: 1, login: "bob", team: null, points: 10, patched: 1, failed: 0, total: 3, apps: { dvwa: { app: "dvwa", points: 10, maxPoints: 30, patched: 1, total: 3 } }, updatedAt: null, lastSolveAt: "2026-08-01T09:00:00.000Z" },
    { rank: 2, login: "ada", team: null, points: 30, patched: 3, failed: 0, total: 3, apps: { dvwa: { app: "dvwa", points: 30, maxPoints: 30, patched: 3, total: 3 } }, updatedAt: null, lastSolveAt: "2026-08-01T10:00:00.000Z" },
  ],
  teams: [],
  generatedAt: "2026-08-01T00:00:00.000Z",
  capabilities: { apps: true, teams: false, challenges: false },
};

describe("leaderboard pipeline", () => {
  it("orders by combined standing even with hints disabled", async () => {
    // withHintPenalties returns early when HINTS_ENABLED is false, so the
    // ordering must already be correct when it runs.
    const out = await withHintPenalties(await withModuleContributions(base));
    expect(out.entries.map((e) => [e.login, e.rank])).toEqual([["ada", 1], ["bob", 2]]);
  });
});
