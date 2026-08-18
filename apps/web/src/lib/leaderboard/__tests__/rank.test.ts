// Unit tests for the standing comparator. Order of precedence:
//   1. challenges solved (patched) desc
//   2. total points desc
//   3. lastSolveAt asc (earlier = reached the score first = higher rank)
// Entries without a solve time sort after those with one.

import { describe, expect, it } from "vitest";
import { rankByStanding } from "../rank";
import type { LeaderboardEntry } from "../types";

function entry(
  login: string,
  { patched = 0, points = 0, lastSolveAt = null as string | null } = {},
): LeaderboardEntry {
  return {
    rank: 0,
    login,
    team: null,
    points,
    patched,
    failed: 0,
    total: 0,
    apps: {},
    updatedAt: null,
    lastSolveAt,
  };
}

describe("rankByStanding", () => {
  it("orders by challenges solved first", () => {
    const ranked = rankByStanding([
      entry("few", { patched: 2, points: 500 }),
      entry("many", { patched: 9, points: 90 }),
    ]);
    expect(ranked.map((e) => [e.login, e.rank])).toEqual([
      ["many", 1],
      ["few", 2],
    ]);
  });

  it("ranks more solves above more points, even at a large points deficit", () => {
    // The headline behaviour change: breadth of solving beats point hoarding.
    const ranked = rankByStanding([
      entry("hoarder", { patched: 1, points: 9999 }),
      entry("grinder", { patched: 2, points: 20 }),
    ]);
    expect(ranked.map((e) => e.login)).toEqual(["grinder", "hoarder"]);
  });

  it("breaks solve-count ties on total points", () => {
    const ranked = rankByStanding([
      entry("cheap", { patched: 5, points: 50 }),
      entry("hard", { patched: 5, points: 120 }),
    ]);
    expect(ranked.map((e) => e.login)).toEqual(["hard", "cheap"]);
  });

  it("breaks solved+points ties by earlier lastSolveAt", () => {
    const ranked = rankByStanding([
      entry("later", { patched: 5, points: 50, lastSolveAt: "2026-08-07T15:00:00Z" }),
      entry("earlier", { patched: 5, points: 50, lastSolveAt: "2026-08-07T12:00:00Z" }),
    ]);
    expect(ranked.map((e) => e.login)).toEqual(["earlier", "later"]);
  });

  it("only consults time when BOTH solved and points are tied", () => {
    // `early` solved first but cleared fewer challenges — it must still lose.
    const ranked = rankByStanding([
      entry("early", { patched: 3, points: 30, lastSolveAt: "2026-08-07T09:00:00Z" }),
      entry("late", { patched: 4, points: 30, lastSolveAt: "2026-08-07T23:00:00Z" }),
    ]);
    expect(ranked.map((e) => e.login)).toEqual(["late", "early"]);
  });

  it("sorts a fully tied entry without a solve time after one with it", () => {
    const ranked = rankByStanding([
      entry("no-time", { patched: 5, points: 50, lastSolveAt: null }),
      entry("timed", { patched: 5, points: 50, lastSolveAt: "2026-08-07T12:00:00Z" }),
    ]);
    expect(ranked.map((e) => e.login)).toEqual(["timed", "no-time"]);
  });

  it("treats an unparseable timestamp like a missing one", () => {
    const ranked = rankByStanding([
      entry("garbage", { patched: 5, points: 50, lastSolveAt: "not-a-date" }),
      entry("timed", { patched: 5, points: 50, lastSolveAt: "2026-08-07T12:00:00Z" }),
    ]);
    expect(ranked.map((e) => e.login)).toEqual(["timed", "garbage"]);
  });

  it("keeps the source order when nothing breaks the tie", () => {
    const ranked = rankByStanding([
      entry("first", { patched: 5, points: 50 }),
      entry("second", { patched: 5, points: 50 }),
    ]);
    expect(ranked.map((e) => [e.login, e.rank])).toEqual([
      ["first", 1],
      ["second", 2],
    ]);
  });

  it("stamps sequential ranks across a mixed field", () => {
    const ranked = rankByStanding([
      entry("d", { patched: 1, points: 10 }),
      entry("a", { patched: 7, points: 70 }),
      entry("c", { patched: 3, points: 99 }),
      entry("b", { patched: 3, points: 100 }),
    ]);
    expect(ranked.map((e) => [e.login, e.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
  });
});

const withModules = (
  login: string,
  patched: number,
  points: number,
  mods: LeaderboardEntry["modules"],
): LeaderboardEntry => ({
  rank: 0, login, team: null, points, patched, failed: 0, total: 0,
  apps: {}, updatedAt: null, lastSolveAt: null, modules: mods,
});

describe("compareStanding across modules", () => {
  it("counts completion across every module, not just patching", () => {
    // ada: 0 patches but 12 quiz answers; bob: 1 patch, no quiz.
    const ada = withModules("ada", 0, 120, {
      quiz: { points: 120, completed: 12, lastActivityAt: null, detail: { kind: "quiz", answered: 12, total: 15, points: 120 } },
    });
    const bob = withModules("bob", 1, 10, {
      "secure-development": { points: 10, completed: 1, lastActivityAt: null, detail: { kind: "secure-development", apps: {} } },
    });
    expect(rankByStanding([bob, ada]).map((e) => e.login)).toEqual(["ada", "bob"]);
  });

  it("falls back to `patched` when a source supplies no modules map", () => {
    const a = withModules("a", 5, 50, {});
    const b = withModules("b", 3, 90, {});
    expect(rankByStanding([b, a]).map((e) => e.login)).toEqual(["a", "b"]);
  });

  it("breaks ties on the earliest activity across modules", () => {
    const early = withModules("early", 1, 10, {
      quiz: { points: 10, completed: 1, lastActivityAt: "2026-08-01T10:00:00.000Z", detail: { kind: "quiz", answered: 1, total: 5, points: 10 } },
    });
    const late = withModules("late", 1, 10, {
      quiz: { points: 10, completed: 1, lastActivityAt: "2026-08-01T12:00:00.000Z", detail: { kind: "quiz", answered: 1, total: 5, points: 10 } },
    });
    expect(rankByStanding([late, early]).map((e) => e.login)).toEqual(["early", "late"]);
  });
});
