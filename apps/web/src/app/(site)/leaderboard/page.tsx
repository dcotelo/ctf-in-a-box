// Server Component: loads scoreboard data + the viewer's session on the
// server, then renders the interactive <Leaderboard> client component with
// both. Data (and auth) in, interactivity down.

import type { Metadata } from "next";
import { headers } from "next/headers";
import PageHeader from "@/components/page-header";
import Leaderboard from "@/components/leaderboard";
import MockDataNotice from "@/components/mock-data-notice";
import { getLeaderboardSource, getLeaderboardSourceMode } from "@/lib/leaderboard/source";
import { withHintPenalties } from "@/lib/leaderboard/hint-penalties";
import { withTeamStandings } from "@/lib/leaderboard/team-standings";
import { formatRelativeTime } from "@/lib/relative-time";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Leaderboard · OWASP CTF @ DEF CON 34",
  description: "Live contestant standings for the OWASP Capture The Flag at DEF CON 34.",
};

export default async function LeaderboardPage() {
  const source = getLeaderboardSource();
  // Penalties before team standings: team totals sum member points, so they
  // must sum the already-deducted (and floored) values.
  const [data, session] = await Promise.all([
    source.getLeaderboard().then(withHintPenalties).then(withTeamStandings),
    auth.api.getSession({ headers: await headers() }),
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
      <Leaderboard
        data={{ ...data, entries }}
        viewerLogin={session?.user?.login ?? null}
      />
    </div>
  );
}
