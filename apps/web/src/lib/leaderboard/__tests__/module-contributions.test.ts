import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardData, LeaderboardEntry, TeamStanding } from "../types";
import { rankByStanding } from "../rank";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  isModuleEnabled: vi.fn((id: string) => id === "secure-development"),
  getQuizTotals: vi.fn(),
  getTeamQuizTotalsBatch: vi.fn(),
  listQuestions: vi.fn(),
  getClassicTotals: vi.fn(),
  getTeamClassicTotalsBatch: vi.fn(),
  listChallenges: vi.fn(),
}));

vi.mock("@/lib/modules", () => ({
  enabledModules: [{ id: "secure-development", displayName: "Secure Development", description: "", targets: ["dvwa"] }],
  isModuleEnabled: mocks.isModuleEnabled,
}));

vi.mock("@/lib/quiz-store", () => ({
  getQuizTotals: mocks.getQuizTotals,
  getTeamQuizTotalsBatch: mocks.getTeamQuizTotalsBatch,
  listQuestions: mocks.listQuestions,
}));

vi.mock("@/lib/classic-store", () => ({
  getClassicTotals: mocks.getClassicTotals,
  getTeamClassicTotalsBatch: mocks.getTeamClassicTotalsBatch,
  listChallenges: mocks.listChallenges,
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

/** Quiz and classic disabled by default (only secure-development enabled),
 *  matching the checked-in event.yaml today. Tests that need one of the
 *  app-side modules override this. */
beforeEach(() => {
  vi.clearAllMocks();
  mocks.isModuleEnabled.mockImplementation((id: string) => id === "secure-development");
  mocks.getQuizTotals.mockResolvedValue(new Map());
  mocks.getTeamQuizTotalsBatch.mockImplementation((teams: readonly string[][]) =>
    Promise.resolve(teams.map(() => ({ points: 0, answered: 0, lastAt: null }))),
  );
  mocks.listQuestions.mockResolvedValue([]);
  mocks.getClassicTotals.mockResolvedValue(new Map());
  mocks.getTeamClassicTotalsBatch.mockImplementation((teams: readonly string[][]) =>
    Promise.resolve(teams.map(() => ({ points: 0, solved: 0, lastAt: null }))),
  );
  mocks.listChallenges.mockResolvedValue([]);
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
    expect(mocks.getTeamQuizTotalsBatch).not.toHaveBeenCalled();
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

    it("creates no rows — a disabled module contributes no points to create one from", async () => {
      const out = await withModuleContributions(data([]));
      expect(out.entries).toEqual([]);
      expect(mocks.getQuizTotals).not.toHaveBeenCalled();
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

    // The board's login set is the UNION of the source's logins and the
    // logins holding module points. Before this, the overlay could only map
    // over rows the scoring backend had already produced, so a contestant
    // whose only points were quiz points had no row to overlay onto and never
    // appeared at all.
    it("creates a row for a contestant with quiz points and no scored submission", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["cyd", { points: 30, answered: 3, lastAt: null }]]));

      const out = await withModuleContributions(data([entry("ada", 30, 3)]));

      const cyd = out.entries.find((e) => e.login === "cyd")!;
      expect(cyd.points).toBe(30);
      // No scoring entry behind this row, so nothing that comes from the
      // scorer may be non-zero on it.
      expect(cyd).toMatchObject({ patched: 0, failed: 0, total: 0, apps: {}, team: null });
      expect(cyd.modules!["secure-development"]).toBeUndefined();
      expect(cyd.modules!["quiz"]).toMatchObject({ points: 30, completed: 3 });
    });

    // C3: secure-development's points are ATTRIBUTED (already inside
    // `entry.points`), quiz points are ADDED. A login in BOTH sources must
    // therefore end up as ONE row whose total is 10 + 30 — never two rows, and
    // never 10 + 30 + 30.
    it("counts a login present in both sources once", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["ada", { points: 30, answered: 3, lastAt: null }]]));

      const out = await withModuleContributions(data([entry("ada", 10, 1)]));

      expect(out.entries).toHaveLength(1);
      expect(out.entries[0].points).toBe(40);
      expect(out.entries[0].modules!["secure-development"]!.points).toBe(10);
      expect(out.entries[0].modules!["quiz"]!.points).toBe(30);
    });

    // The scorer records the PR author's login; the quiz records the session's.
    // Matching them exactly would split one contestant into two rows the moment
    // the two disagreed on case — the union is taken case-insensitively, like
    // admin-auth and hint-store do.
    it("matches logins case-insensitively, so one contestant never becomes two rows", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["ADA", { points: 30, answered: 3, lastAt: null }]]));

      const out = await withModuleContributions(data([entry("ada", 10, 1)]));

      expect(out.entries).toHaveLength(1);
      // The scored row's own spelling wins — it is the row that already exists.
      expect(out.entries[0].login).toBe("ada");
      expect(out.entries[0].points).toBe(40);
    });

    it("ranks created rows against scored rows", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["cyd", { points: 99, answered: 9, lastAt: null }]]));

      const out = await withModuleContributions(data([entry("bob", 10, 1)]));

      expect(out.entries.map((e) => [e.login, e.rank])).toEqual([["cyd", 1], ["bob", 2]]);
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
      // getTeamQuizTotalsBatch owns the union-by-question dedupe logic
      // (proven at the store level in quiz-store.test.ts, where two members
      // sharing the same question collapse to one). This test only checks
      // that withModuleContributions ADDS whatever that function returns —
      // it is NOT the dedupe proof itself.
      mocks.getTeamQuizTotalsBatch.mockResolvedValue([{ points: 20, answered: 1, lastAt: "2026-08-01T11:00:00.000Z" }]);

      const teams: TeamStanding[] = [
        { rank: 1, slug: "red", name: "Red", captain: "ada", points: 30, members: ["ada", "cyd"] },
      ];
      const out = await withModuleContributions(data([entry("ada", 30, 3)], teams));

      expect(mocks.getTeamQuizTotalsBatch).toHaveBeenCalledWith([["ada", "cyd"]]);
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

      expect(mocks.getTeamQuizTotalsBatch).not.toHaveBeenCalled();
      expect(out.teams).toEqual(teams);
    });

    // I4: the per-team form issued its own pipeline per team, so a 25-team
    // event cost 25 Upstash round trips on every render of a page that is
    // dynamic and fetched `no-store`. The overlay must hand the WHOLE board
    // to the batched helper in one call.
    it("asks for every team's quiz total in a single batched call", async () => {
      mocks.getTeamQuizTotalsBatch.mockResolvedValue([
        { points: 20, answered: 1, lastAt: "2026-08-01T11:00:00.000Z" },
        { points: 5, answered: 1, lastAt: "2026-08-01T12:00:00.000Z" },
        { points: 0, answered: 0, lastAt: null },
      ]);

      const teams: TeamStanding[] = [
        { rank: 1, slug: "red", name: "Red", captain: "ada", points: 30, members: ["ada", "cyd"] },
        { rank: 2, slug: "blue", name: "Blue", captain: "bob", points: 20, members: ["bob"] },
        { rank: 3, slug: "grey", name: "Grey", captain: "eve", points: 10, members: ["eve"] },
      ];
      const out = await withModuleContributions(data([entry("ada", 30, 3)], teams));

      expect(mocks.getTeamQuizTotalsBatch).toHaveBeenCalledTimes(1);
      expect(mocks.getTeamQuizTotalsBatch).toHaveBeenCalledWith([["ada", "cyd"], ["bob"], ["eve"]]);
      // Each team's own total landed on its own row (order preserved
      // through the batch's partitioning), and the quiz-less team got none.
      expect(out.teams.map((t) => [t.slug, t.points])).toEqual([["red", 50], ["blue", 25], ["grey", 10]]);
      expect(out.teams.find((t) => t.slug === "grey")!.modules?.["quiz"]).toBeUndefined();
    });

    // I3: the two reads are settled independently. `listQuestions` supplies
    // only the "answered / total" DENOMINATOR — if it fails, the board must
    // keep every contestant's quiz POINTS (and the ranking they drive),
    // never silently zero them and re-rank on wrong totals while /profile
    // still shows the real number.
    it("keeps quiz points and ranking when only the question list fails", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["bob", { points: 15, answered: 2, lastAt: null }]]));
      mocks.listQuestions.mockRejectedValue(new Error("upstash blip"));

      const out = await withModuleContributions(
        data([
          entry("ada", 30, 3),
          { ...entry("bob", 20, 2), apps: { dvwa: { app: "dvwa", points: 20, maxPoints: 30, patched: 2, total: 3 } } },
        ]),
      );

      // bob's 20 + 15 quiz = 35 still beats ada's 30, exactly as it would
      // have with a healthy question list.
      expect(out.entries.map((e) => [e.login, e.points])).toEqual([["bob", 35], ["ada", 30]]);
      const quiz = out.entries[0].modules!["quiz"]!;
      expect(quiz.points).toBe(15);
      // Only the denominator degrades — and it degrades to the clamp, never
      // below the numerator.
      expect(quiz.detail).toEqual({ kind: "quiz", answered: 2, total: 2, points: 15 });
    });

    it("still shows the board when only the totals read fails", async () => {
      mocks.getQuizTotals.mockRejectedValue(new Error("upstash blip"));

      const out = await withModuleContributions(data([entry("ada", 30, 3)]));

      expect(out.entries[0].points).toBe(30);
      expect(out.entries[0].modules!["quiz"]).toBeUndefined();
      // C4: the totals map is where created rows come from, so a failed read
      // degrades to the quiz-less board — it must never invent rows, and
      // certainly not zero-point ones.
      expect(out.entries.map((e) => e.login)).toEqual(["ada"]);
    });

    // I1's display bug: `deleteQuestion` deliberately leaves banked points
    // and the aggregate `answered` counter alone, so after a delete a login
    // can hold more answers than the question list has entries. The
    // denominator must never render below the numerator ("1 / 0 answered").
    it("never renders a denominator smaller than the numerator after a question is deleted", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["ada", { points: 10, answered: 1, lastAt: null }]]));
      mocks.listQuestions.mockResolvedValue([]); // the only question was deleted

      const out = await withModuleContributions(data([entry("ada", 30, 3)]));

      const quiz = out.entries[0].modules!["quiz"]!;
      expect(quiz.detail).toEqual({ kind: "quiz", answered: 1, total: 1, points: 10 });
      // Points already banked for the deleted question stay on the board.
      expect(out.entries[0].points).toBe(40);
    });

    it("clamps a team's denominator the same way", async () => {
      mocks.listQuestions.mockResolvedValue([{ id: "q1" }]);
      mocks.getTeamQuizTotalsBatch.mockResolvedValue([{ points: 30, answered: 3, lastAt: null }]);

      const teams: TeamStanding[] = [
        { rank: 1, slug: "red", name: "Red", captain: "ada", points: 30, members: ["ada", "cyd"] },
      ];
      const out = await withModuleContributions(data([entry("ada", 30, 3)], teams));

      expect(out.teams[0].modules!["quiz"]!.detail).toEqual({ kind: "quiz", answered: 3, total: 3, points: 30 });
    });
  });

  describe("with the classic module disabled", () => {
    it("never reads classic data and adds no classic block", async () => {
      const out = await withModuleContributions(data([entry("ada", 30, 3)]));
      expect(out.entries[0].modules!["classic"]).toBeUndefined();
      expect(out.entries[0].points).toBe(30);
      expect(mocks.getClassicTotals).not.toHaveBeenCalled();
      expect(mocks.listChallenges).not.toHaveBeenCalled();
    });
  });

  describe("with the classic module enabled", () => {
    beforeEach(() => {
      mocks.isModuleEnabled.mockImplementation((id: string) => id === "secure-development" || id === "classic");
      mocks.listChallenges.mockResolvedValue([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    });

    // The scorer never sees a captured flag, so classic points are NOT already
    // inside `entry.points` — they are ADDED. Attributing them (the verb
    // secure-development uses, because ITS points already are inside
    // `entry.points`) would show the contestant's classic total as zero.
    it("ADDS classic points rather than attributing them", async () => {
      mocks.getClassicTotals.mockResolvedValue(new Map([["alice", { points: 50, solved: 2, lastAt: null }]]));

      const out = await withModuleContributions(data([entry("alice", 100, 3)]));

      expect(out.entries[0].points).toBe(150); // 100 scored + 50 classic
      const classic = out.entries[0].modules!["classic"]!;
      expect(classic).toMatchObject({ points: 50, completed: 2 });
      expect(classic.detail).toEqual({ kind: "classic", solved: 2, total: 3, points: 50 });
      // secure-development's own attribution is untouched by the addition.
      expect(out.entries[0].modules!["secure-development"]).toMatchObject({ points: 100, completed: 3 });
    });

    // Without this, every contestant on a classic-only event is invisible:
    // the source is `emptySource` and carries no rows at all to overlay onto.
    it("creates a row for a login with classic points and no scored entry", async () => {
      mocks.getClassicTotals.mockResolvedValue(new Map([["alice", { points: 50, solved: 2, lastAt: null }]]));

      const out = await withModuleContributions(data([]));

      expect(out.entries.map((e) => e.login)).toContain("alice");
      const alice = out.entries.find((e) => e.login === "alice")!;
      expect(alice.points).toBe(50);
      // Nothing behind this row came from the scorer, so nothing scorer-shaped
      // may be non-zero on it.
      expect(alice).toMatchObject({ patched: 0, failed: 0, total: 0, apps: {}, team: null });
      expect(alice.modules!["classic"]).toMatchObject({ points: 50, completed: 2 });
    });

    // The scorer records the PR author's login, the classic store the
    // session's. Matching them exactly would split one contestant into two
    // rows the moment the two disagreed on case.
    it("unions logins case-insensitively so one contestant is never two rows", async () => {
      mocks.getClassicTotals.mockResolvedValue(new Map([["alice", { points: 50, solved: 2, lastAt: null }]]));

      const out = await withModuleContributions(data([entry("Alice", 0, 0)]));

      expect(out.entries).toHaveLength(1);
      // The scored row's own spelling wins — it is the row that already exists
      // — and it carries the classic points, proving the LOOKUP is
      // case-insensitive too and not just the create-or-not decision.
      expect(out.entries[0].login).toBe("Alice");
      expect(out.entries[0].points).toBe(50);
      expect(out.entries[0].modules!["classic"]).toMatchObject({ points: 50, completed: 2 });
    });

    // The denominator is cosmetic; the points are not. A shared try/catch
    // over the two reads silently deleted everyone's points and re-ranked the
    // board — a bug this kit has already shipped once, on the quiz path.
    it("keeps points when only the challenge list read fails", async () => {
      mocks.getClassicTotals.mockResolvedValue(new Map([["alice", { points: 50, solved: 2, lastAt: null }]]));
      mocks.listChallenges.mockRejectedValue(new Error("upstash blip"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const out = await withModuleContributions(data([entry("alice", 0, 0)]));

        expect(out.entries[0].points).toBe(50);
        // Only the denominator degrades — and it degrades to the clamp, never
        // below its own numerator.
        expect(out.entries[0].modules!["classic"]!.detail).toEqual({
          kind: "classic",
          solved: 2,
          total: 2,
          points: 50,
        });
      } finally {
        err.mockRestore();
      }
    });

    it("still shows the board when only the totals read fails", async () => {
      mocks.getClassicTotals.mockRejectedValue(new Error("upstash blip"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const out = await withModuleContributions(data([entry("ada", 30, 3)]));

        expect(out.entries[0].points).toBe(30);
        expect(out.entries[0].modules!["classic"]).toBeUndefined();
        // The totals map is where created rows come from, so a failed read
        // degrades to the classic-less board — never invented rows.
        expect(out.entries.map((e) => e.login)).toEqual(["ada"]);
      } finally {
        err.mockRestore();
      }
    });

    // `deleteChallenge` deliberately leaves banked points and the aggregate
    // counter alone, so the challenge list can be SHORTER than the solve
    // count. Unclamped this renders "1 / 0 flags".
    it("clamps the denominator below its own numerator", async () => {
      mocks.getClassicTotals.mockResolvedValue(new Map([["alice", { points: 50, solved: 1, lastAt: null }]]));
      mocks.listChallenges.mockResolvedValue([]); // the only challenge was deleted

      const out = await withModuleContributions(data([entry("alice", 0, 0)]));

      const detail = out.entries[0].modules?.classic?.detail;
      if (detail?.kind !== "classic") throw new Error("shape");
      expect(detail.total).toBeGreaterThanOrEqual(detail.solved);
      expect(detail).toEqual({ kind: "classic", solved: 1, total: 1, points: 50 });
      // Points already banked for the deleted challenge stay on the board.
      expect(out.entries[0].points).toBe(50);
    });

    it("gives a login with no solves no classic block", async () => {
      mocks.getClassicTotals.mockResolvedValue(new Map([["ada", { points: 0, solved: 0, lastAt: null }]]));

      const out = await withModuleContributions(data([entry("ada", 30, 3)]));

      expect(out.entries[0].modules!["classic"]).toBeUndefined();
      expect(out.entries[0].points).toBe(30);
      // …and a zero-solve login must not become a row of its own either.
      expect(out.entries).toHaveLength(1);
    });

    it("reflects the added classic points in ranking", async () => {
      mocks.getClassicTotals.mockResolvedValue(new Map([["bob", { points: 40, solved: 3, lastAt: null }]]));

      const out = await withModuleContributions(
        data([
          entry("ada", 30, 3),
          { ...entry("bob", 20, 2), apps: { dvwa: { app: "dvwa", points: 20, maxPoints: 30, patched: 2, total: 3 } } },
        ]),
      );

      expect(out.entries.map((e) => [e.login, e.points])).toEqual([["bob", 60], ["ada", 30]]);
      expect(out.entries.map((e) => e.rank)).toEqual([1, 2]);
    });

    // ONE pipeline for the whole board, never one call per team: /leaderboard
    // is dynamic and fetched `no-store`, so a per-team form would bill a
    // 25-team event 25 Upstash round trips on every single page view.
    it("asks for every team's classic total in a single batched call", async () => {
      mocks.getTeamClassicTotalsBatch.mockResolvedValue([
        { points: 20, solved: 1, lastAt: "2026-08-01T11:00:00.000Z" },
        { points: 0, solved: 0, lastAt: null },
      ]);

      const teams: TeamStanding[] = [
        { rank: 1, slug: "red", name: "Red", captain: "ada", points: 30, members: ["ada", "cyd"] },
        { rank: 2, slug: "grey", name: "Grey", captain: "eve", points: 10, members: ["eve"] },
      ];
      const out = await withModuleContributions(data([entry("ada", 30, 3)], teams));

      expect(mocks.getTeamClassicTotalsBatch).toHaveBeenCalledTimes(1);
      expect(mocks.getTeamClassicTotalsBatch).toHaveBeenCalledWith([["ada", "cyd"], ["eve"]]);
      // 30 (already-deduped secure-dev team points) + 20 (the ONE challenge's
      // points) — never 40, which would double count it across both members.
      expect(out.teams.map((t) => [t.slug, t.points])).toEqual([["red", 50], ["grey", 10]]);
      expect(out.teams[0].modules!["classic"]).toMatchObject({ points: 20, completed: 1 });
      // A team with no solves gets no block rather than an empty one.
      expect(out.teams.find((t) => t.slug === "grey")!.modules?.["classic"]).toBeUndefined();
    });
  });

  // Both app-side modules on at once. The two are added independently and must
  // land on ONE row per contestant — not one row per module, and not one
  // module's points silently replacing the other's.
  describe("with both quiz and classic enabled", () => {
    beforeEach(() => {
      mocks.isModuleEnabled.mockImplementation((id: string) => id !== "secure-development");
      mocks.listQuestions.mockResolvedValue([{ id: "q1" }, { id: "q2" }]);
      mocks.listChallenges.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    });

    it("creates ONE row carrying both modules' blocks and both modules' points", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["alice", { points: 15, answered: 1, lastAt: null }]]));
      // Different casing from the quiz store's spelling of the same login.
      mocks.getClassicTotals.mockResolvedValue(new Map([["Alice", { points: 50, solved: 2, lastAt: null }]]));

      const out = await withModuleContributions(data([]));

      expect(out.entries).toHaveLength(1);
      expect(out.entries[0].points).toBe(65);
      expect(out.entries[0].modules!["quiz"]).toMatchObject({ points: 15, completed: 1 });
      expect(out.entries[0].modules!["classic"]).toMatchObject({ points: 50, completed: 2 });
    });

    it("adds both modules' points to one scored row", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["ada", { points: 15, answered: 1, lastAt: null }]]));
      mocks.getClassicTotals.mockResolvedValue(new Map([["ada", { points: 50, solved: 2, lastAt: null }]]));

      const out = await withModuleContributions(data([entry("ada", 10, 1)]));

      expect(out.entries).toHaveLength(1);
      expect(out.entries[0].points).toBe(75); // 10 + 15 + 50
    });

    it("adds both modules' points to one team row", async () => {
      mocks.getTeamQuizTotalsBatch.mockResolvedValue([{ points: 15, answered: 1, lastAt: null }]);
      mocks.getTeamClassicTotalsBatch.mockResolvedValue([{ points: 50, solved: 2, lastAt: null }]);

      const teams: TeamStanding[] = [
        { rank: 1, slug: "red", name: "Red", captain: "ada", points: 30, members: ["ada"] },
      ];
      const out = await withModuleContributions(data([entry("ada", 30, 3)], teams));

      expect(out.teams[0].points).toBe(95); // 30 + 15 + 50
      expect(out.teams[0].modules!["quiz"]).toMatchObject({ points: 15 });
      expect(out.teams[0].modules!["classic"]).toMatchObject({ points: 50 });
    });

    // One module's outage must cost only its own points — never the other's.
    it("keeps quiz points when the classic totals read fails", async () => {
      mocks.getQuizTotals.mockResolvedValue(new Map([["ada", { points: 15, answered: 1, lastAt: null }]]));
      mocks.getClassicTotals.mockRejectedValue(new Error("upstash blip"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const out = await withModuleContributions(data([entry("ada", 10, 1)]));
        expect(out.entries[0].points).toBe(25);
        expect(out.entries[0].modules!["quiz"]).toMatchObject({ points: 15 });
        expect(out.entries[0].modules!["classic"]).toBeUndefined();
      } finally {
        err.mockRestore();
      }
    });
  });
});
