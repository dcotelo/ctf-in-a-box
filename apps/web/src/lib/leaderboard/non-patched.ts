// One definition of "non-patched" and of the challenge denominator, shared by
// the public leaderboard row and the profile dossier.
//
// The two pages used to compute this independently — same expression
// (`total - patched`), different `total` — so the same contestant could read
// `311 non-patched` on the board and `320 non-patched / 321 total` on their
// own profile, and a contestant with nothing scored yet read `0 non-patched /
// 0 total` on a 321-challenge event. Both call in here now; changing the rule
// means changing it once.

import { enabledTotalChallenges } from "@/lib/apps";

/** How many secure-development challenges this event ships — the denominator.
 *  Baked from `event.yaml`'s `targets` at build time (see lib/apps.ts), so it
 *  is a fixed property of the event, not of what the contestant has done.
 *
 *  That distinction is the whole point: a scored-results count reads as `0 of
 *  0` on a fresh account and GROWS as the contestant attempts more, which is
 *  the opposite of what a denominator does.
 *
 *  `sourceTotal` — whatever the active leaderboard source reported for this
 *  row — is the floor, not the value: a source that knows about more
 *  challenges than the vendored catalogue (a newer rubric behind an older app
 *  build) is believed rather than clamped, which also keeps `nonPatchedCount`
 *  from having to defend against a negative. */
export function challengeTotal(sourceTotal: number): number {
  return Math.max(enabledTotalChallenges, sourceTotal);
}

/** "Non-patched" = everything not yet fixed: failed runs AND challenges the
 *  contestant hasn't touched. Deliberately not called "failed" — someone who
 *  simply hasn't gotten to a challenge yet shouldn't read it as losing. */
export function nonPatchedCount(patched: number, sourceTotal: number): number {
  return Math.max(0, challengeTotal(sourceTotal) - patched);
}
