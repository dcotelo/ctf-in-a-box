// The leaderboard page's fixed composition order:
//   withHintPenalties → withModuleContributions → withTeamStandings
// These tests pin the two properties that order exists to guarantee.

import { describe, expect, it, vi } from "vitest";
import type { LeaderboardData } from "../types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/modules", () => ({
  enabledModules: [{ id: "secure-development", displayName: "Secure Development", description: "", targets: ["dvwa"] }],
  isModuleEnabled: (id: string) => id === "secure-development",
}));

// Mutable so a single module graph can cover both the hints-off and hints-on
// pipelines (vi.mock is hoisted and applies for the whole file).
const hints = { enabled: false, penalties: new Map<string, number>() };
vi.mock("@/lib/hint-store", () => ({
  // Policy now lives inside getHintPenalties (it consults resolveHintConfig),
  // so an "off" event yields an empty map rather than a false capability flag.
  getHintPenalties: async () => (hints.enabled ? hints.penalties : new Map<string, number>()),
  HINTS_AVAILABLE: true,
}));

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

const pipeline = (data: LeaderboardData) => withHintPenalties(data).then(withModuleContributions);

describe("leaderboard pipeline", () => {
  it("orders by combined standing even with hints disabled", async () => {
    // getHintPenalties yields an empty map when hints are off, so the
    // final order has to be withModuleContributions' doing — which is exactly
    // why it runs LAST and re-ranks unconditionally.
    hints.enabled = false;
    const out = await pipeline(base);
    expect(out.entries.map((e) => [e.login, e.rank])).toEqual([["ada", 1], ["bob", 2]]);
  });

  it("attributes NET points to the module, so the module block matches the header", async () => {
    // Regression: with the overlay running first, an expanded row showed
    // header 20 pts / −10 hints above "SECURE DEVELOPMENT 30 pts".
    hints.enabled = true;
    hints.penalties = new Map([["ada", 10]]);
    try {
      const out = await pipeline(base);
      const ada = out.entries.find((e) => e.login === "ada")!;
      expect(ada.points).toBe(20);
      expect(ada.hintPenalty).toBe(10);
      expect(ada.modules!["secure-development"]!.points).toBe(ada.points);
      // …and every row, penalised or not, agrees with its own header.
      for (const e of out.entries) {
        expect(e.modules!["secure-development"]!.points).toBe(e.points);
      }
    } finally {
      hints.enabled = false;
      hints.penalties = new Map();
    }
  });
});
