// The profile header's "N of M pts available" denominator must not depend
// on whether THIS viewer happens to have a scorer profile yet. Before this
// fix, `maxPointsAcrossModules` took the secure-development ceiling from
// `profile?.maxPoints` — 0 until the login's first ingested score created a
// profile — so a fresh login read "0 of 3,275" and the very next scored PR
// jumped the denominator by the whole 668-point secure-development ceiling
// (issue #383). The Challenges page's own ceiling — the LIVE enabled
// targets' summed catalogue points, `getEnabledTotals().maxPoints`
// (lib/enabled-apps.ts, issue #386 PR 2) — is viewer-independent and is the
// source this reads instead, threaded in as `ProfileModuleInput.
// enabledMaxPoints` since module-blocks.ts stays a pure function with no
// server-only import of its own; `atLeast(…, securePoints)` survives only as
// the floor for banked-but-deleted points.
import { describe, expect, it } from "vitest";
import { maxPointsAcrossModules, moduleRow, remainingFor } from "@/app/(site)/profile/module-blocks";
import type { ProfileModuleInput } from "@/app/(site)/profile/module-blocks";
import type { ModuleProgress } from "@/lib/leaderboard/types";
import type { ResolvedModule } from "@/lib/modules";
import { apps } from "@/lib/apps";

// The full catalogue's total, computed here rather than imported — the
// build-time `enabledTotalMaxPoints` constant this test used to import was
// removed (issue #386 PR 2: which targets are LIVE is a runtime /admin
// setting, not a build-time slice of the catalogue).
const FULL_CATALOGUE_TOTAL = apps.reduce((sum, a) => sum + a.maxPoints, 0);

// A runtime subset narrower than the full catalogue — as if an organizer
// disabled everything but these two targets. Its total is deliberately far
// below FULL_CATALOGUE_TOTAL so a test that silently fell back to the full
// catalogue sum (the exact #386 regression this guards) fails loudly rather
// than by coincidence.
const NARROW_SUBSET = apps.filter((a) => a.id === "dvwa" || a.id === "vampi");
const NARROW_SUBSET_TOTAL = NARROW_SUBSET.reduce((sum, a) => sum + a.maxPoints, 0);

function inputWith(
  profile: ProfileModuleInput["profile"],
  { secureDev = true, enabledMaxPoints = FULL_CATALOGUE_TOTAL }: { secureDev?: boolean; enabledMaxPoints?: number } = {},
): ProfileModuleInput {
  return {
    profile,
    appsRecord: {},
    challengeCount: 0,
    enabledMaxPoints,
    secureDev,
  } as unknown as ProfileModuleInput;
}

describe("maxPointsAcrossModules — the secure-development ceiling", () => {
  it("a login with no scorer profile at all still gets the full catalogue ceiling", () => {
    const total = maxPointsAcrossModules(inputWith(null), 0);
    expect(total).toBe(FULL_CATALOGUE_TOTAL);
  });

  it("a scorer profile whose maxPoints is LOWER than the catalogue total still gets the catalogue total", () => {
    // A stale/partial profile (or one from before a target was added) must
    // not shrink the ceiling below what the Challenges page itself shows.
    const profile = { points: 2, maxPoints: 10 } as unknown as ProfileModuleInput["profile"];
    const total = maxPointsAcrossModules(inputWith(profile), 2);
    expect(total).toBe(FULL_CATALOGUE_TOTAL);
  });

  it("banked points that exceed the catalogue total are the floor, not the catalogue total", () => {
    // A target removed from the event after points were banked on it: the
    // ceiling must never read lower than what is already earned.
    const banked = FULL_CATALOGUE_TOTAL + 50;
    const profile = { points: banked, maxPoints: 10 } as unknown as ProfileModuleInput["profile"];
    const total = maxPointsAcrossModules(inputWith(profile), banked);
    expect(total).toBe(banked);
  });

  it("contributes nothing when secure-development isn't live, no scorer profile or not", () => {
    const total = maxPointsAcrossModules(inputWith(null, { secureDev: false }), 0);
    expect(total).toBe(0);
  });

  it("the ceiling follows a NARROWER runtime-enabled subset, not the full catalogue", () => {
    // The regression this guards: a ceiling that silently fell back to the
    // full-catalogue sum instead of the live subset's would still pass every
    // test above (both totals are computed off `apps`) but would be wrong
    // the moment an organizer disables a target.
    const profile = { points: 2, maxPoints: 10 } as unknown as ProfileModuleInput["profile"];
    const total = maxPointsAcrossModules(inputWith(profile, { enabledMaxPoints: NARROW_SUBSET_TOTAL }), 2);
    expect(total).toBe(NARROW_SUBSET_TOTAL);
    expect(total).toBeLessThan(FULL_CATALOGUE_TOTAL);
  });
});

// Review follow-up: #383's fix only changed maxPointsAcrossModules (the
// header). moduleRow's own "secure-development" case and remainingFor's
// footer line both still read profile?.maxPoints directly, so a profile
// whose maxPoints is below the catalogue total showed the header at the
// catalogue ceiling while the module's own row and the "still winnable" line
// showed the lower, profile-derived number — the exact header/row
// disagreement the file's doc comments (issue #330/#343) claim is
// impossible.
describe("every secure-development ceiling on the profile agrees with the header", () => {
  it("moduleRow's max and remainingFor's max equal maxPointsAcrossModules's, even when profile.maxPoints is below the catalogue total", () => {
    const profile = {
      points: 2,
      maxPoints: 10, // deliberately below FULL_CATALOGUE_TOTAL
      patched: 1,
    } as unknown as ProfileModuleInput["profile"];
    const input = inputWith(profile);
    const securePoints = profile!.points;

    const headerCeiling = maxPointsAcrossModules(input, securePoints);
    expect(headerCeiling).toBe(FULL_CATALOGUE_TOTAL);

    const row = moduleRow(
      { points: securePoints, completed: 1, detail: { kind: "secure-development" } } as unknown as ModuleProgress,
      input,
    );
    expect(row.max).toBe(headerCeiling);

    const footer = remainingFor(
      [{ id: "secure-development", title: "Secure Development" }] as unknown as ResolvedModule[],
      input,
    );
    expect(footer).toHaveLength(1);
    expect(footer[0].max).toBe(headerCeiling);
  });

  it("agreement holds for a narrower runtime subset too, not only the full catalogue", () => {
    const profile = { points: 2, maxPoints: 10, patched: 1 } as unknown as ProfileModuleInput["profile"];
    const input = inputWith(profile, { enabledMaxPoints: NARROW_SUBSET_TOTAL });
    const securePoints = profile!.points;

    const headerCeiling = maxPointsAcrossModules(input, securePoints);
    expect(headerCeiling).toBe(NARROW_SUBSET_TOTAL);

    const row = moduleRow(
      { points: securePoints, completed: 1, detail: { kind: "secure-development" } } as unknown as ModuleProgress,
      input,
    );
    expect(row.max).toBe(headerCeiling);

    const footer = remainingFor(
      [{ id: "secure-development", title: "Secure Development" }] as unknown as ResolvedModule[],
      input,
    );
    expect(footer).toHaveLength(1);
    expect(footer[0].max).toBe(headerCeiling);
  });
});
