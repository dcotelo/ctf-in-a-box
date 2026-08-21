import { NextResponse } from "next/server";
import { getAdminSettings } from "@/lib/admin-store";
import { SCORE_COOLDOWN_MIN } from "@/lib/scoring-defaults";

/**
 * Scoring knobs that each fork's Action needs at run time (issue #46).
 *
 * WHY THIS IS PUBLIC AND UNAUTHENTICATED.
 *
 * The re-run cooldown is enforced by a GitHub Action running inside a
 * contestant's fork, which cannot reach the box's Redis. For an organizer to
 * change it during a running event, the value has to travel to the runner
 * somehow. The alternative considered was writing an Actions variable through
 * the GitHub API, which would mean the App gaining Actions **write** on every
 * fork and the web tier holding the App private key — a compromised app would
 * gain org-wide write. That is the blast radius ADR 41 exists to keep small.
 *
 * So the runner pulls instead of the box pushing, and this endpoint carries
 * exactly what a fork's workflow needs: numbers that are already visible in
 * every rendered workflow file and in the score comments themselves. There is
 * nothing here worth authenticating, and authenticating it would mean putting
 * a credential in every fork.
 *
 * KEEP IT THAT WAY. Anything added to this payload is world-readable by
 * definition. Scoring POLICY (how long to wait) belongs here; scoring
 * MECHANISM (tokens, rubric internals, who solved what) does not.
 *
 * Uncached: an organizer changing the cooldown expects the next run to see it,
 * and the request rate is one per scored push, not per page view.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  let cooldownMinutes = SCORE_COOLDOWN_MIN;
  try {
    const settings = await getAdminSettings();
    if (settings.scoreCooldownMin !== null) cooldownMinutes = settings.scoreCooldownMin;
  } catch {
    // Fail to the DEFAULT, not to an error. The workflow already falls back on
    // its own when this is unreachable; answering with the baked default keeps
    // the two paths agreeing instead of making a Redis blip look like a
    // deliberate "no cooldown".
  }
  return NextResponse.json({ cooldownMinutes });
}
