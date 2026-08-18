import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardData, LeaderboardEntry, TeamStanding } from "../types";
import { rankByStanding } from "../rank";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  isModuleEnabled: vi.fn((id: string) => id === "secure-development"),
  getQuizTotals: vi.fn(),
  getTeamQuizTotals: vi.fn(),
  listQuestions: vi.fn(),
}));

vi.mock("@/lib/modules", () => ({
  enabledModules: [{ id: "secure-development", displayName: "Secure Development", description: "", targets: ["dvwa"] }],
  isModuleEnabled: mocks.isModuleEnabled,
}));

vi.mock("@/lib/quiz-store", () => ({
  getQuizTotals: mocks.getQuizTotals,
  getTeamQuizTotals: mocks.getTeamQuizTotals,
  listQuestions: mocks.listQuestions,
}));

import { withModuleContributions } from "../module-contributions";

const entry = (login: string, points: number, patched: number, lastSolveAt = "2026-08-01T10:00:00.000Z"): LeaderboardEntry => ({
  rank: 0, login, team: null, points, patched, failed: 0, total: 3,
  apps: { dvwa: { app: "dvwa", points, maxPoints: 30, patched, total: 3 } },
  updatedAt: null, lastSolveAt,
});

const data = (entries: LeaderboardEntry[], teams: TeamStanding[] = []): LeaderboardData => ({
  entries: entries.map((e, i) => ({ ...e, rank: i + 1 })),
  teams,
  generatedAt: "2026-08-01T00:00:00.000Z",
  capabilities: { apps: true, teams: teams.length > 0, challenges: false },
});

/** Quiz disabled by default (only secure-development enabled), matching the
 *  checked-in event.yaml today. Tests that need the quiz module override this. */
beforeEach(() => {
  vi.clearAllMocks();
  mocks.isModuleEnabled.mockImplementation((id: string) => id === "secure-development");
  mocks.getQuizTotals.mockResolvedValue(new Map());
  mocks.getTeamQuizTotals.mockResolvedValue({ points: 0, answered: 0, lastAt: null });
  mocks.listQuestions.mockResolvedValue([]);
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
    // Team rows get no quiz overlay here when the quiz module is disabled
    // (the default) or when the source has no deduped team data yet.
    const teams = [{ rank: 1, slug: "red", name: "Red", captain: "ada", points: 30, members: ["ada"] }];
    const out = await withModuleContributions({ ...data([entry("ada", 30, 3)]), teams });
    expect(out.teams).toEqual(teams);
    expect(mocks.getTeamQuizTotals).not.toHaveBeenCalled();
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

  // Regression gate specific to phase 2: with the quiz module DISABLED, the
  // leaderboard must behave EXACTLY as it did before this task — no quiz
  // reads, no quiz block, no ranking change driven by quiz data.
  describe("with the quiz module disabled", () => {
    it("never reads quiz data and adds no quiz block", async () => {
      const out = await withModuleContributions(data([entry("ada", 30, 3)]));
      expect(out.entries[0].modules!["quiz"]).toBeUndefined();
      expect(out.entries[0].points).toBe(30);
      expect(mocks.getQuizTotals).not.toHaveBeenCalled();
      expect(mocks.listQuestions).not.toHaveBeenCalled();
    });
  });

  describe("with the quiz module enabled", () => {
    beforeEach(() => {
      mocks.isModuleEnabled.mockImplementation((id: string) => id === "secure-development" || id === "quiz");
      mocks.listQuestions.mockResolvedValue([{ id: "q1" }, { id: "q2" }, { id: "q3" }]);
    });

    it("adds quiz points to the entry's total and renders a quiz module with completed = answered count", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["ada", { points: 15, answered: 2, lastAt: null }]]));

      const out = await withModuleContributions(data([entry("ada", 30, 3)]));

      // ADDED, not attributed: 30 (secure-dev, unchanged) + 15 (quiz) = 45.
      expect(out.entries[0].points).toBe(45);
      const quiz = out.entries[0].modules!["quiz"]!;
      expect(quiz).toMatchObject({ points: 15, completed: 2 });
      expect(quiz.detail).toEqual({ kind: "quiz", answered: 2, total: 3, points: 15 });
      // secure-development's own attribution is untouched by the addition.
      expect(out.entries[0].modules!["secure-development"]).toMatchObject({ points: 30, completed: 3 });
    });

    it("gives an entry with no quiz activity no quiz module block", async () => {
      // ada has no entry in the aggregate map at all — never answered anything.
      mocks.getQuizTotals.mockResolvedValue(new Map());

      const out = await withModuleContributions(data([entry("ada", 30, 3)]));

      expect(out.entries[0].modules!["quiz"]).toBeUndefined();
      expect(out.entries[0].points).toBe(30);
    });

    it("reflects the added quiz points in ranking", async () => {
      // Same breadth (secure-dev completed=3 vs quiz completed=1 -> combined
      // completed 3 for both), so the tie falls to points: ada's raw 30 loses
      // to bob's 20 + 15 quiz = 35, once the quiz points are added.
      mocks.getQuizTotals.mockResolvedValue(
        new Map([["bob", { points: 15, answered: 1, lastAt: null }]]),
      );

      const out = await withModuleContributions(
        data([entry("ada", 30, 3), { ...entry("bob", 20, 2), apps: { dvwa: { app: "dvwa", points: 20, maxPoints: 30, patched: 2, total: 3 } } }]),
      );

      expect(out.entries.map((e) => [e.login, e.points])).toEqual([["bob", 35], ["ada", 30]]);
      expect(out.entries.map((e) => e.rank)).toEqual([1, 2]);
    });

    // Regression (C1): rank.ts's completedCount must not drop `patched` the
    // moment ANY module populates `modules` — only when secure-development's
    // OWN block is present does `patched` already have a representative in
    // the sum. On upstash (`capabilities.apps: false`), a row never gets a
    // secure-development block, so answering a quiz question (which DOES
    // stamp a `quiz` block) must not zero out that row's real patch count.
    // ada has more patches AND a quiz answer on top of bob — she must never
    // rank below him.
    it("does not let quiz activity demote a patched-heavy row on an upstash-shaped board", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["ada", { points: 5, answered: 1, lastAt: null }]]));

      const bare = (login: string, points: number, patched: number) => ({
        ...entry(login, points, patched), apps: {},
      });

      const out = await withModuleContributions({
        ...data([bare("ada", 50, 5), bare("bob", 30, 3)]),
        capabilities: { apps: false, teams: false, challenges: false },
      });

      expect(out.entries.map((e) => e.login)).toEqual(["ada", "bob"]);
      expect(out.entries[0].modules!["secure-development"]).toBeUndefined();
      expect(out.entries[0].modules!["quiz"]).toBeDefined();
    });

    it("adds the team's already-deduped quiz total to team points", async () => {
      // getTeamQuizTotals owns the union-by-question dedupe logic (proven at
      // the store level in quiz-store.test.ts, where two members sharing the
      // same question collapse to one). This test only checks that
      // withModuleContributions ADDS whatever that function returns — it is
      // NOT the dedupe proof itself.
      mocks.getTeamQuizTotals.mockResolvedValue({ points: 20, answered: 1, lastAt: "2026-08-01T11:00:00.000Z" });

      const teams: TeamStanding[] = [
        { rank: 1, slug: "red", name: "Red", captain: "ada", points: 30, members: ["ada", "cyd"] },
      ];
      const out = await withModuleContributions(data([entry("ada", 30, 3)], teams));

      expect(mocks.getTeamQuizTotals).toHaveBeenCalledWith(["ada", "cyd"]);
      // 30 (existing, already-deduped secure-dev team points) + 20 (the ONE
      // question's points) — never 40 (which would be double counting the
      // question across both members).
      expect(out.teams[0].points).toBe(50);
      expect(out.teams[0].modules!["quiz"]).toMatchObject({ points: 20, completed: 1 });
    });

    it("does not touch team points when the source has no deduped team data yet (upstash shape)", async () => {
      const teams: TeamStanding[] = [
        { rank: 1, slug: "red", name: "Red", captain: "ada", points: 0, members: ["ada", "cyd"] },
      ];
      const out = await withModuleContributions({
        ...data([entry("ada", 30, 3)], teams),
        capabilities: { apps: true, teams: false, challenges: false },
      });

      expect(mocks.getTeamQuizTotals).not.toHaveBeenCalled();
      expect(out.teams).toEqual(teams);
    });
  });
});
