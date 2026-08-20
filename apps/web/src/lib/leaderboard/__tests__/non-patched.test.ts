// The leaderboard row and the profile dossier print "non-patched" from this
// one helper. They used to compute it independently, off two different
// denominators, and disagreed for the same contestant.
import { describe, expect, it } from "vitest";
import { enabledTotalChallenges } from "@/lib/apps";
import { challengeTotal, nonPatchedCount } from "@/lib/leaderboard/non-patched";

describe("challengeTotal", () => {
  // Non-vacuity: the whole helper is pointless if the event's catalogue is
  // empty, and every assertion below would pass trivially.
  it("has a non-empty catalogue to work with in this build", () => {
    expect(enabledTotalChallenges).toBeGreaterThan(0);
  });

  // The bug: a contestant who has scored nothing has no row at all, so the
  // source reports 0 — and their profile read "0 non-patched / 0 total" on an
  // event with a full catalogue in front of them.
  it("falls back to the event's catalogue when the source reports nothing", () => {
    expect(challengeTotal(0)).toBe(enabledTotalChallenges);
  });

  it("believes a source that knows about more challenges than the catalogue", () => {
    expect(challengeTotal(enabledTotalChallenges + 7)).toBe(enabledTotalChallenges + 7);
  });
});

describe("nonPatchedCount", () => {
  it("counts everything not yet fixed, including untouched challenges", () => {
    expect(nonPatchedCount(1, 0)).toBe(enabledTotalChallenges - 1);
    expect(nonPatchedCount(0, 0)).toBe(enabledTotalChallenges);
  });

  // "Not yet fixed" is a property of the event, not of how much the
  // contestant has attempted — so attempting more must not inflate it.
  it("does not grow as the contestant attempts more challenges", () => {
    const afterOneAttempt = nonPatchedCount(0, 1);
    const afterTwenty = nonPatchedCount(0, 20);
    expect(afterTwenty).toBe(afterOneAttempt);
  });

  it("never goes negative when a contestant has patched the whole catalogue", () => {
    expect(nonPatchedCount(enabledTotalChallenges, enabledTotalChallenges)).toBe(0);
    expect(nonPatchedCount(enabledTotalChallenges + 5, 0)).toBe(0);
  });
});
