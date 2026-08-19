// The shared union-by-item team fold. Both quiz-store's `foldTeamAnswers` and
// classic-store's `foldTeamSolves` are now thin renames over this function, so
// this file is where the DEDUPE RULE itself is pinned — the store-level tests
// prove each module's transport and vocabulary, this one proves the arithmetic
// they both depend on.
import { describe, expect, it } from "vitest";
import { foldTeamItems } from "../team-fold";

/** One member's `HGETALL` reply: the flat [field, value, field, value, …]
 *  array Upstash returns, with each value JSON-encoded exactly as the stores
 *  write it. */
function reply(items: Record<string, { points: number; at: string }>): { result: string[] } {
  return { result: Object.entries(items).flatMap(([id, v]) => [id, JSON.stringify(v)]) };
}

describe("foldTeamItems", () => {
  it("counts an item two members both hold exactly once, at the earliest", () => {
    const total = foldTeamItems([
      reply({ "c-1": { points: 50, at: "2026-08-19T10:00:00.000Z" } }),
      reply({ "c-1": { points: 90, at: "2026-08-19T11:00:00.000Z" } }),
    ]);
    expect(total).toEqual({ points: 50, completed: 1, lastAt: "2026-08-19T10:00:00.000Z" });
  });

  // Same pair, opposite argument order: the winner must be decided by the
  // TIMESTAMP, never by which member the caller happened to list first. A
  // fold that simply overwrote (or simply kept the first seen) would pass one
  // of these two orderings and fail the other.
  it("keeps the earliest regardless of the order the members arrive in", () => {
    const total = foldTeamItems([
      reply({ "c-1": { points: 90, at: "2026-08-19T11:00:00.000Z" } }),
      reply({ "c-1": { points: 50, at: "2026-08-19T10:00:00.000Z" } }),
    ]);
    expect(total).toEqual({ points: 50, completed: 1, lastAt: "2026-08-19T10:00:00.000Z" });
  });

  it("sums distinct items across members without dropping any", () => {
    const total = foldTeamItems([
      reply({
        "c-1": { points: 10, at: "2026-08-19T10:00:00.000Z" },
        "c-2": { points: 20, at: "2026-08-19T12:00:00.000Z" },
      }),
      reply({ "c-3": { points: 5, at: "2026-08-19T11:00:00.000Z" } }),
    ]);
    expect(total).toEqual({ points: 35, completed: 3, lastAt: "2026-08-19T12:00:00.000Z" });
  });

  // `lastAt` is "most recent activity" for the leaderboard's activity column —
  // the LATEST timestamp in the deduped set, which is a different value from
  // the earliest one the dedupe itself keeps.
  it("reports the LATEST timestamp even though the dedupe keeps the earliest record", () => {
    const total = foldTeamItems([
      reply({
        "c-1": { points: 10, at: "2026-08-19T09:00:00.000Z" },
        "c-2": { points: 10, at: "2026-08-19T18:00:00.000Z" },
      }),
      // A duplicate of c-1 at a later time: it loses the dedupe (c-1 stays at
      // 10 points) and, having lost it, contributes nothing to lastAt either.
      reply({ "c-1": { points: 999, at: "2026-08-19T23:00:00.000Z" } }),
    ]);
    expect(total).toEqual({ points: 20, completed: 2, lastAt: "2026-08-19T18:00:00.000Z" });
  });

  it("skips unparseable rows rather than throwing", () => {
    expect(foldTeamItems([{ result: ["c-1", "not json"] }])).toEqual({
      points: 0,
      completed: 0,
      lastAt: null,
    });
  });

  it("skips wrong-shaped rows while keeping the good ones on the same member", () => {
    const total = foldTeamItems([
      {
        result: [
          "c-1",
          JSON.stringify({ points: "50", at: "2026-08-19T10:00:00.000Z" }), // points not a number
          "c-2",
          JSON.stringify({ points: 50 }), // no timestamp
          "c-3",
          JSON.stringify(null), // parses, but not an object
          "c-4",
          JSON.stringify({ points: 7, at: "2026-08-19T10:00:00.000Z" }), // the only good row
        ],
      },
    ]);
    expect(total).toEqual({ points: 7, completed: 1, lastAt: "2026-08-19T10:00:00.000Z" });
  });

  it("treats a missing, errored, or empty member reply as no items", () => {
    const total = foldTeamItems([
      undefined,
      { error: "WRONGTYPE" },
      { result: [] },
      reply({ "c-1": { points: 5, at: "2026-08-19T10:00:00.000Z" } }),
    ]);
    expect(total).toEqual({ points: 5, completed: 1, lastAt: "2026-08-19T10:00:00.000Z" });
  });

  it("returns a zero total for a team with no members at all", () => {
    expect(foldTeamItems([])).toEqual({ points: 0, completed: 0, lastAt: null });
  });
});
