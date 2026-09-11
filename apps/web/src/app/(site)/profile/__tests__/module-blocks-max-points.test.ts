// The profile header's "N of M pts available" denominator must not depend
// on whether THIS viewer happens to have a scorer profile yet. Before this
// fix, `maxPointsAcrossModules` took the secure-development ceiling from
// `profile?.maxPoints` — 0 until the login's first ingested score created a
// profile — so a fresh login read "0 of 3,275" and the very next scored PR
// jumped the denominator by the whole 668-point secure-development ceiling
// (issue #383). The Challenges page's own ceiling (`enabledTotalMaxPoints`,
// the sum of the enabled targets' catalogue points) is viewer-independent and
// is the source this reads instead; `atLeast(…, securePoints)` survives only
// as the floor for banked-but-deleted points.
import { describe, expect, it } from "vitest";
import { maxPointsAcrossModules } from "@/app/(site)/profile/module-blocks";
import type { ProfileModuleInput } from "@/app/(site)/profile/module-blocks";
import { enabledTotalMaxPoints } from "@/lib/apps";

function inputWith(profile: ProfileModuleInput["profile"], secureDev = true): ProfileModuleInput {
  return {
    profile,
    appsRecord: {},
    challengeCount: 0,
    secureDev,
  } as unknown as ProfileModuleInput;
}

describe("maxPointsAcrossModules — the secure-development ceiling", () => {
  it("a login with no scorer profile at all still gets the full catalogue ceiling", () => {
    const total = maxPointsAcrossModules(inputWith(null), 0);
    expect(total).toBe(enabledTotalMaxPoints);
  });

  it("a scorer profile whose maxPoints is LOWER than the catalogue total still gets the catalogue total", () => {
    // A stale/partial profile (or one from before a target was added) must
    // not shrink the ceiling below what the Challenges page itself shows.
    const profile = { points: 2, maxPoints: 10 } as unknown as ProfileModuleInput["profile"];
    const total = maxPointsAcrossModules(inputWith(profile), 2);
    expect(total).toBe(enabledTotalMaxPoints);
  });

  it("banked points that exceed the catalogue total are the floor, not the catalogue total", () => {
    // A target removed from the event after points were banked on it: the
    // ceiling must never read lower than what is already earned.
    const banked = enabledTotalMaxPoints + 50;
    const profile = { points: banked, maxPoints: 10 } as unknown as ProfileModuleInput["profile"];
    const total = maxPointsAcrossModules(inputWith(profile), banked);
    expect(total).toBe(banked);
  });

  it("contributes nothing when secure-development isn't live, no scorer profile or not", () => {
    const total = maxPointsAcrossModules(inputWith(null, false), 0);
    expect(total).toBe(0);
  });
});
