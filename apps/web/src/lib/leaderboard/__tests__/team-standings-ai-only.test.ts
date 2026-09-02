// withTeamStandings on an AI-ONLY event: the source has no team concept (and
// no rows at all), so every team row on the board is one this overlay
// synthesises from membership. Mirrors team-standings-quiz-only.test.ts's
// structure — see that file's header for the rationale.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardData } from "../types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/enabled-modules", () => import("@/test/enabled-modules-baked"));
vi.mock("@/lib/event-config", () => ({
  eventConfig: { targets: [], modules: [{ id: "ai" }] },
}));

const mocks = vi.hoisted(() => ({
  listTeams: vi.fn<() => Promise<{ slug: string; name: string; members: string[] }[]>>(),
  getAiTotals: vi.fn(),
  getTeamAiTotalsBatch: vi.fn(),
  listAiChallenges: vi.fn(),
}));

vi.mock("@/lib/team-store", () => ({ listTeams: mocks.listTeams }));
vi.mock("@/lib/ai-store", () => ({
  getAiTotals: mocks.getAiTotals,
  getTeamAiTotalsBatch: mocks.getTeamAiTotalsBatch,
  listAiChallenges: mocks.listAiChallenges,
}));

import { withModuleContributions } from "../module-contributions";
import { withTeamStandings } from "../team-standings";

const totals = (points: number, solved: number, lastAt: string | null = null) => ({ points, solved, lastAt });

/** Stubs the batch keyed on each team's FIRST MEMBER rather than on
 *  position — see the quiz-only sibling's identical helper for why. */
function totalsByMember(byMember: Record<string, ReturnType<typeof totals>>) {
  mocks.getTeamAiTotalsBatch.mockImplementation((teams: readonly string[][]) =>
    Promise.resolve(teams.map((members) => byMember[members[0]] ?? totals(0, 0))),
  );
}

/** Exactly what `emptySource` hands the pipeline on an ai-only event. */
const empty = (): LeaderboardData => ({
  entries: [],
  teams: [],
  generatedAt: "2026-08-01T00:00:00.000Z",
  capabilities: { apps: false, teams: false, challenges: false },
});

/** The real pipeline's last two stages, in the real order. */
const pipeline = (data: LeaderboardData) => withModuleContributions(data).then(withTeamStandings);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAiTotals.mockResolvedValue(new Map());
  mocks.listAiChallenges.mockResolvedValue([{ id: "a1" }, { id: "a2" }, { id: "a3" }]);
  mocks.getTeamAiTotalsBatch.mockImplementation((teams: readonly string[][]) =>
    Promise.resolve(teams.map(() => totals(0, 0))),
  );
});

describe("withTeamStandings on an ai-only event", () => {
  it("ranks synthesised teams by their real ai points, not alphabetically", async () => {
    mocks.listTeams.mockResolvedValue([
      { slug: "z", name: "Zulu", members: ["ada"] },
      { slug: "a", name: "Alfa", members: ["bob"] },
    ]);
    // Alfa is first alphabetically but has fewer points.
    totalsByMember({ ada: totals(40, 4), bob: totals(10, 1) });

    const out = await withTeamStandings(empty());

    expect(out.teams.map((t) => [t.name, t.points, t.rank])).toEqual([
      ["Zulu", 40, 1],
      ["Alfa", 10, 2],
    ]);
    expect(out.teams[0].modules!["ai"]).toMatchObject({ points: 40, completed: 4 });
  });

  // The established team rule: a team's ai total is the UNION of the
  // challenges its members solved, so a challenge two teammates both solved
  // counts ONCE. That fold lives in getTeamAiTotalsBatch — this overlay must
  // USE it and must never re-derive a team score by summing member
  // aggregates.
  it("takes the deduped team total rather than summing member points", async () => {
    mocks.listTeams.mockResolvedValue([{ slug: "red", name: "Red", members: ["ada", "cyd"] }]);
    // Both members banked the SAME 30-point challenge: 30 as a team, 60 summed.
    mocks.getAiTotals.mockResolvedValue(
      new Map([
        ["ada", totals(30, 1)],
        ["cyd", totals(30, 1)],
      ]),
    );
    mocks.getTeamAiTotalsBatch.mockResolvedValue([totals(30, 1)]);

    const out = await pipeline(empty());

    expect(mocks.getTeamAiTotalsBatch).toHaveBeenCalledTimes(1);
    expect(mocks.getTeamAiTotalsBatch).toHaveBeenCalledWith([["ada", "cyd"]]);
    expect(out.teams[0].points).toBe(30);
    // The individual rows still carry their own full totals — only the team
    // figure is deduped.
    expect(out.entries.map((e) => e.points)).toEqual([30, 30]);
  });

  it("asks for every team's total in a single batched call", async () => {
    mocks.listTeams.mockResolvedValue([
      { slug: "red", name: "Red", members: ["ada"] },
      { slug: "blue", name: "Blue", members: ["bob"] },
      { slug: "grey", name: "Grey", members: ["cyd"] },
    ]);
    totalsByMember({ ada: totals(30, 3), bob: totals(20, 2), cyd: totals(0, 0) });

    const out = await withTeamStandings(empty());

    expect(mocks.getTeamAiTotalsBatch).toHaveBeenCalledTimes(1);
    expect(out.teams.map((t) => [t.slug, t.points])).toEqual([
      ["red", 30],
      ["blue", 20],
      ["grey", 0],
    ]);
    // A team with no solves gets no block rather than an empty one.
    expect(out.teams.find((t) => t.slug === "grey")!.modules?.["ai"]).toBeUndefined();
  });

  it("attributes a member whose casing differs from the membership record", async () => {
    mocks.getAiTotals.mockResolvedValue(new Map([["Ada", totals(30, 3)]]));
    mocks.listTeams.mockResolvedValue([{ slug: "red", name: "Red", members: ["ada"] }]);
    mocks.getTeamAiTotalsBatch.mockResolvedValue([totals(30, 3)]);

    const out = await pipeline(empty());

    expect(out.entries.map((e) => [e.login, e.team])).toEqual([["Ada", "red"]]);
  });

  it("keeps the alphabetical order when no team has any module points", async () => {
    mocks.listTeams.mockResolvedValue([
      { slug: "z", name: "Zulu", members: ["ada"] },
      { slug: "a", name: "Alfa", members: ["bob"] },
    ]);

    const out = await withTeamStandings(empty());

    expect(out.teams.map((t) => [t.name, t.points, t.rank])).toEqual([
      ["Alfa", 0, 1],
      ["Zulu", 0, 2],
    ]);
  });

  it("leaves the teams at zero when the team totals read fails", async () => {
    mocks.listTeams.mockResolvedValue([{ slug: "red", name: "Red", members: ["ada"] }]);
    mocks.getTeamAiTotalsBatch.mockRejectedValue(new Error("upstash blip"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await withTeamStandings(empty());
      expect(out.teams.map((t) => [t.slug, t.points])).toEqual([["red", 0]]);
      expect(out.teams[0].modules?.["ai"]).toBeUndefined();
    } finally {
      err.mockRestore();
    }
  });

  it("keeps team points and order when only the challenge list fails", async () => {
    mocks.listTeams.mockResolvedValue([
      { slug: "z", name: "Zulu", members: ["ada"] },
      { slug: "a", name: "Alfa", members: ["bob"] },
    ]);
    totalsByMember({ ada: totals(40, 4), bob: totals(10, 1) });
    mocks.listAiChallenges.mockRejectedValue(new Error("upstash blip"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await withTeamStandings(empty());
      expect(out.teams.map((t) => [t.name, t.points])).toEqual([
        ["Zulu", 40],
        ["Alfa", 10],
      ]);
      expect(out.teams[0].modules!["ai"]!.detail).toEqual({
        kind: "ai",
        solved: 4,
        total: 4,
        points: 40,
      });
    } finally {
      err.mockRestore();
    }
  });

  it("reads no team totals when there are no teams", async () => {
    mocks.listTeams.mockResolvedValue([]);
    const base = empty();
    expect(await withTeamStandings(base)).toBe(base);
    expect(mocks.getTeamAiTotalsBatch).not.toHaveBeenCalled();
  });

  it("no-ops on a source that already carries teams, so points are never added twice", async () => {
    const base: LeaderboardData = {
      ...empty(),
      teams: [{ rank: 1, slug: "red", name: "Red", captain: "ada", points: 50, members: ["ada"] }],
      capabilities: { apps: true, teams: true, challenges: false },
    };

    const out = await withTeamStandings(base);

    expect(out).toBe(base);
    expect(mocks.getTeamAiTotalsBatch).not.toHaveBeenCalled();
  });
});
