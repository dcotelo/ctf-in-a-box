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
import { event } from "@/lib/site";
import { getResolvedModules } from "@/lib/resolved-modules";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: `Live contestant standings for ${event.name}.`,
};

export default async function LeaderboardPage() {
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
    source.getLeaderboard().then(withHintPenalties).then(withModuleContributions).then(withTeamStandings),
    auth.api.getSession({ headers: await headers() }),
    getResolvedModules(),
  ]);

  // Pre-format relative times server-side so client and server render
  // identical markup (see src/lib/relative-time.ts).
  const generatedAtMs = Date.parse(data.generatedAt);
  const entries = data.entries.map((entry) => ({
    ...entry,
    updatedAgo: entry.updatedAt ? formatRelativeTime(entry.updatedAt, generatedAtMs) : undefined,
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Standings"
        title="Leaderboard"
        description="Live contestant rankings from patched PRs. Sign in with GitHub to highlight your own row and unlock your profile."
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
