// The leaderboard row and the profile dossier print "non-patched" from this
// one helper. They used to compute it independently, off two different
// denominators, and disagreed for the same contestant.
//
// `challengeTotal`/`nonPatchedCount` are pure now (issue #386, PR 2): the
// event's live target total is read once by the caller (`getEnabledTotals()`
// in lib/enabled-apps.ts) and passed in as `enabledTotal`, rather than this
// module reading a build-time constant itself. A fixed local stands in for
// that live total here — the point under test is the ARITHMETIC, not what
// this build's catalogue happens to sum to.
import { describe, expect, it } from "vitest";
import { challengeTotal, nonPatchedCount } from "@/lib/leaderboard/non-patched";

const ENABLED_TOTAL = 321;

describe("challengeTotal", () => {
  // The bug: a contestant who has scored nothing has no row at all, so the
  // source reports 0 — and their profile read "0 non-patched / 0 total" on an
  // event with a full catalogue in front of them.
  it("falls back to the event's live target total when the source reports nothing", () => {
    expect(challengeTotal(ENABLED_TOTAL, 0)).toBe(ENABLED_TOTAL);
  });

  it("believes a source that knows about more challenges than the live total", () => {
    expect(challengeTotal(ENABLED_TOTAL, ENABLED_TOTAL + 7)).toBe(ENABLED_TOTAL + 7);
  });
});

describe("nonPatchedCount", () => {
  it("counts everything not yet fixed, including untouched challenges", () => {
    expect(nonPatchedCount(ENABLED_TOTAL, 1, 0)).toBe(ENABLED_TOTAL - 1);
    expect(nonPatchedCount(ENABLED_TOTAL, 0, 0)).toBe(ENABLED_TOTAL);
  });

  // "Not yet fixed" is a property of the event, not of how much the
  // contestant has attempted — so attempting more must not inflate it.
  it("does not grow as the contestant attempts more challenges", () => {
    const afterOneAttempt = nonPatchedCount(ENABLED_TOTAL, 0, 1);
    const afterTwenty = nonPatchedCount(ENABLED_TOTAL, 0, 20);
    expect(afterTwenty).toBe(afterOneAttempt);
  });

  it("never goes negative when a contestant has patched the whole catalogue", () => {
    expect(nonPatchedCount(ENABLED_TOTAL, ENABLED_TOTAL, ENABLED_TOTAL)).toBe(0);
    expect(nonPatchedCount(ENABLED_TOTAL, ENABLED_TOTAL + 5, 0)).toBe(0);
  });

  // Reacts to a smaller live total (a target switched off): the same
  // contestant, the same source, a different event shape.
  it("tracks the live total when it shrinks, not a baked-in one", () => {
    expect(challengeTotal(10, 0)).toBe(10);
    expect(nonPatchedCount(10, 3, 0)).toBe(7);
  });
});
