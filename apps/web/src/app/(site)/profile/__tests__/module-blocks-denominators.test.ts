// A progress row's two halves come from different places, and deleting a
// solved challenge splits them (issue #330).
//
// The numerator counts SOLVE RECORDS, which survive deletion on purpose — the
// admin delete dialog promises it: "Points already banked for it stay on the
// leaderboard." The denominator counts the LIVE CATALOGUE, which no longer has
// the challenge in it. So an organizer who deletes two solved AI challenges
// mid-event hands every affected contestant:
//
//     AI Challenges   5 / 5 cleared   870 / 850 pts
//
// with a bar filled past its own end, while the board they browse says 3 / 3.
//
// What must never survive is a ratio greater than one. These pin that for
// every module, both halves.
import { describe, expect, it } from "vitest";
import { moduleRow } from "@/app/(site)/profile/module-blocks";
import type { ProfileModuleInput } from "@/app/(site)/profile/module-blocks";
import type { ModuleProgress } from "@/lib/leaderboard/types";

/** Live catalogue: 3 challenges worth 850. Banked: 5 solves worth 870 — the
 *  two extra came from challenges an organizer has since deleted. */
const LIVE_ITEMS = 3;
const LIVE_POINTS = 850;
const BANKED_ITEMS = 5;
const BANKED_POINTS = 870;

const input = {
  profile: { points: BANKED_POINTS, maxPoints: LIVE_POINTS },
  appsRecord: {},
  challengeCount: LIVE_ITEMS,
  secureDev: true,
  quiz: { questions: [], maxPoints: LIVE_POINTS, viewer: {} },
  classic: { challenges: [], maxPoints: LIVE_POINTS, viewer: {} },
  ai: { challenges: [], maxPoints: LIVE_POINTS, viewer: {} },
} as unknown as ProfileModuleInput;

const progressFor = (detail: ModuleProgress["detail"]): ModuleProgress =>
  ({ points: BANKED_POINTS, completed: BANKED_ITEMS, detail }) as unknown as ModuleProgress;

const cases = [
  ["quiz", { kind: "quiz", answered: BANKED_ITEMS, total: LIVE_ITEMS }],
  ["classic", { kind: "classic", solved: BANKED_ITEMS, total: LIVE_ITEMS }],
  ["ai", { kind: "ai", solved: BANKED_ITEMS, total: LIVE_ITEMS }],
  ["secure-development", { kind: "secure-development" }],
] as unknown as Array<[string, ModuleProgress["detail"]]>;

describe("a progress row never reports more than its own total", () => {
  for (const [name, detail] of cases) {
    it(`${name}: the count denominator covers solves whose challenge was deleted`, () => {
      const row = moduleRow(progressFor(detail), input);
      expect(row.done).toBe(BANKED_ITEMS);
      // Union, not live-only: the solves are real and the leaderboard counts
      // them, so they stay visible rather than being dropped from the row.
      expect(row.total).toBeGreaterThanOrEqual(row.done);
      expect(row.total).toBe(BANKED_ITEMS);
    });

    it(`${name}: the points denominator covers points banked on a deleted challenge`, () => {
      const row = moduleRow(progressFor(detail), input);
      expect(row.earned).toBe(BANKED_POINTS);
      // "870 / 850 pts" is the defect exactly.
      expect(row.max).toBeGreaterThanOrEqual(row.earned);
    });
  }

  it("leaves an untouched catalogue's denominators alone", () => {
    // The clamp must not inflate a row that has nothing deleted behind it: a
    // contestant 1 of 3 in is still 1 of 3, not 1 of 1.
    const row = moduleRow(
      { points: 10, completed: 1, detail: { kind: "ai", solved: 1, total: LIVE_ITEMS } } as unknown as ModuleProgress,
      input,
    );
    expect(row.total).toBe(LIVE_ITEMS);
    expect(row.max).toBe(LIVE_POINTS);
  });
});
