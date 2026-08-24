// Server Component: loads scoreboard data + the viewer's session on the
// server, then renders the interactive <Leaderboard> client component with
// both. Data (and auth) in, interactivity down.

import type { Metadata } from "next";
import { headers } from "next/headers";
import PageHeader from "@/components/page-header";
import Leaderboard from "@/components/leaderboard";
import MockDataNotice from "@/components/mock-data-notice";
import { getLeaderboardSource, getLeaderboardSourceMode } from "@/lib/leaderboard/source";
import { withModuleContributions } from "@/lib/leaderboard/module-contributions";
import { withHintPenalties } from "@/lib/leaderboard/hint-penalties";
import { withTeamStandings } from "@/lib/leaderboard/team-standings";
import { formatRelativeTime } from "@/lib/relative-time";
import { auth } from "@/lib/auth";
import DisplayBoard from "@/components/display-board";
import { resolvePhase } from "@/components/phase-line";
import { completedCount } from "@/lib/leaderboard/rank";
import { event } from "@/lib/site";
import { getResolvedModules } from "@/lib/resolved-modules";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: `Live contestant standings for ${event.name}.`,
};

// One lede for every event shape. The old secure-development branch said
// "rankings from patched PRs", which was false the moment a second module
// was enabled — quiz answers and flags rank here too, and the board itself
// folds every enabled module (issue #200, 1.4). A lede that names one
// module's currency on a shared board misinforms; the plain statement is
// true on every event including a secure-development-only one.
//
// The sign-in clause renders only for the visitor it applies to: telling a
// signed-in contestant to "Sign in with GitHub" reads as broken state
// detection (issue #200, 3.1 — the same fix the hint banner got). The page
// already loads the session for the YOU-row highlight, so this costs
// nothing.
const BASE_DESCRIPTION = "Live contestant rankings from every enabled challenge board.";
const SIGNED_OUT_CLAUSE = " Sign in with GitHub to highlight your own row and unlock your profile.";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ display?: string }>;
}) {
  // ?display=1 is the projector surface: chrome-free top ten, viewport-scaled
  // type, self-refreshing (display-board.tsx). Resolved first so the display
  // render can skip nothing it needs and everything it doesn't.
  const wantsDisplay = (await searchParams)?.display === "1";
  const source = getLeaderboardSource();
  // Penalties BEFORE module contributions: withModuleContributions
  // attributes each row's `points` into its per-module breakdown, so it has
  // to see the already-deducted (and floored) net figure — running it first
  // stamps gross module points onto a row whose header shows net, and the
  // expanded row then contradicts itself. Ordering is safe either way and
  // strictly safer this way: the module overlay re-ranks UNCONDITIONALLY on
  // combined standing (breadth across modules, then points, then activity),
  // so running it last means the final order is always its doing, never
  // withHintPenalties' — which returns early when hints are disabled.
  // Team standings last: they only overlay membership onto sources with no
  // team concept, and read the entries as already scored and ranked.
  const [data, session, modules] = await Promise.all([
    source.getLeaderboard().then(withModuleContributions).then(withTeamStandings).then(withHintPenalties),
    auth.api.getSession({ headers: await headers() }),
    getResolvedModules(),
  ]);

  // Pre-format relative times server-side so client and server render
  // identical markup (see src/lib/relative-time.ts).
  const generatedAtMs = Date.parse(data.generatedAt);

  if (wantsDisplay) {
    const phaseInfo = await resolvePhase();
    // Teams when the event has them, individuals otherwise — the same
    // primary view the interactive board defaults to.
    const rows =
      data.teams.length > 0
        ? data.teams.slice(0, 10).map((t) => ({
            key: t.slug,
            rank: t.rank,
            name: t.name,
            points: t.points,
          }))
        : data.entries.slice(0, 10).map((e) => ({
            key: e.login,
            rank: e.rank,
            name: e.login,
            points: e.points,
            solved: completedCount(e),
          }));
    return (
      <DisplayBoard
        rows={rows}
        eventName={event.name}
        phaseLabel={phaseInfo ? phaseInfo.phase : null}
      />
    );
  }
  const entries = data.entries.map((entry) => ({
    ...entry,
    updatedAgo: entry.updatedAt ? formatRelativeTime(entry.updatedAt, generatedAtMs) : undefined,
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Standings"
        title="Leaderboard"
        description={session ? BASE_DESCRIPTION : BASE_DESCRIPTION + SIGNED_OUT_CLAUSE}
      />
      {getLeaderboardSourceMode() === "mock" && <MockDataNotice />}
      {/* data.series/teamSeries pass straight through this spread — the
          chart itself lives inside <Leaderboard> now, so it can switch
          between them as the individual/teams view toggle flips. */}
      <Leaderboard
        data={{ ...data, entries }}
        viewerLogin={session?.user?.login ?? null}
        modules={modules}
      />
    </div>
  );
}
