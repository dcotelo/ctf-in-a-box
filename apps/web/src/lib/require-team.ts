import "server-only";
import { redirect } from "next/navigation";
import { hasTeam } from "@/lib/team-store";

/**
 * Page-level half of the team requirement (issue #153).
 *
 * The API routes are the boundary that actually holds — a direct POST never
 * sees a page — and they refuse a teamless login with `403 { error:
 * "no-team" }`. This exists so nobody discovers that by answering a question
 * and being told it didn't count: a signed-in contestant with no team is sent
 * to set one up before they reach a module at all.
 *
 * Deliberately its own module rather than a function in `team-store.ts`:
 * `redirect()` comes from `next/navigation` and throws a framework control-flow
 * signal, which is exactly the wrong thing to have reachable from a store that
 * API routes and the sync-facing code also import.
 */

/** Where a teamless contestant is sent. The `#team` fragment scrolls the
 *  profile straight to the team card rather than dropping them at the top of
 *  a page of stats with no clue why they are there. */
export const TEAM_SETUP_PATH = "/profile#team";

/**
 * Redirects a signed-in contestant with no team to team setup.
 *
 * Two exemptions, both deliberate:
 *
 * SIGNED OUT passes through. A visitor browsing the board is not yet a
 * contestant, and bouncing them to a profile page they cannot see would be
 * worse than the sign-in prompt the page already renders.
 *
 * ADMINS pass through. An organizer opens a module page to check that their
 * questions and challenges render, which is not playing, and forcing them into
 * a team to do it would be a strange toll. It is not a scoring hole: an admin
 * who actually submits still meets the route gate, because an admin's points
 * fold into no team either.
 *
 * Inherits `hasTeam`'s fail-open behaviour — a Redis blip leaves contestants
 * on the page rather than herding everyone to /profile mid-event.
 */
export async function redirectIfTeamless(
  login: string | undefined,
  options: { isAdmin?: boolean } = {},
): Promise<void> {
  if (!login || options.isAdmin) return;
  if (await hasTeam(login)) return;
  redirect(TEAM_SETUP_PATH);
}
