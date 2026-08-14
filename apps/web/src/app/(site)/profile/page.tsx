// Gated Server Component: real gate (proxy.ts only does an optimistic cookie
// check — this getSession call is what actually matters). Loads the
// contestant's progress from the active leaderboard source and renders their
// dossier: identity, overall progress, per-app breakdown, and team control.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import PageHeader from "@/components/page-header";
import AppChallengeList from "@/components/app-challenge-list";
import TeamCard from "@/components/team-card";
import { appsById } from "@/lib/apps";
import { auth } from "@/lib/auth";
import { getViewerHints } from "@/lib/hint-store";
import { getLeaderboardSource } from "@/lib/leaderboard/source";
import { getViewerTeam, TEAM_MAX_MEMBERS, TEAM_WRITES_ENABLED } from "@/lib/team-store";
import { event } from "@/lib/site";

export const metadata: Metadata = {
  title: "Profile",
  description: `Your personal progress across ${event.name} challenges.`,
};

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/");

  const login = (session.user as { login?: string }).login;
  if (!login) redirect("/");

  const [profile, storeTeam, viewerHints] = await Promise.all([
    getLeaderboardSource().getUser(login),
    getViewerTeam(login),
    getViewerHints(login),
  ]);

  // Live/mock team membership from the store wins; fall back to whatever the
  // leaderboard source reports (only the mock fixture populates it today).
  const team =
    storeTeam ??
    (profile?.team ? { slug: profile.team, name: profile.teamName ?? profile.team, members: [] } : null);
  const effectiveTeam = team?.slug ?? null;
  // "Non-patched" = everything not yet fixed (failed runs + untouched
  // challenges) — deliberately not called "failed" so contestants who
  // haven't gotten to a challenge yet don't read it as losing.
  const nonPatched = profile ? Math.max(0, profile.total - profile.patched) : 0;
  // Hint spend is deducted as an overlay (same math as the leaderboard's
  // withHintPenalties) so the profile matches the contestant's public row.
  const netPoints = Math.max(0, (profile?.points ?? 0) - viewerHints.spent);
  // Sources without per-challenge point data (lambda/upstash) report
  // maxPoints 0 — fall back to patched/total so the bar still means something.
  const progressPct = !profile
    ? 0
    : profile.maxPoints > 0
      ? (netPoints / profile.maxPoints) * 100
      : profile.total > 0
        ? (profile.patched / profile.total) * 100
        : 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Agent dossier" title={login} description="Your progress across every target this event." />

      <div className="ds-card flex flex-col gap-4 rounded-lg border border-white/[0.06] bg-[#16162a] p-5 sm:flex-row sm:items-center">
        <Image
          src={session.user.image ?? `https://avatars.githubusercontent.com/${login}`}
          alt=""
          width={64}
          height={64}
          className="flex-none rounded-full border border-white/10"
          unoptimized
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="font-mono text-lg text-white">{login}</p>
            {effectiveTeam && (
              <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                {effectiveTeam}
              </span>
            )}
          </div>
          <div className="mt-3 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#2563eb] to-[#14b8a6]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <div className="flex flex-none gap-6 text-right">
          <div>
            <p className="font-mono text-xl font-bold tabular-nums text-white">{netPoints}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted">points</p>
          </div>
          {viewerHints.count > 0 && (
            <div>
              <p className="font-mono text-xl tabular-nums text-[#d4a017]">−{viewerHints.spent}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted">
                hints ({viewerHints.count})
              </p>
            </div>
          )}
          <div>
            <p className="font-mono text-xl tabular-nums text-[#22c55e]">{profile?.patched ?? 0}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted">patched</p>
          </div>
          <div>
            <p className="font-mono text-xl tabular-nums text-zinc-300">{nonPatched}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted">non-patched</p>
          </div>
          <div>
            <p className="font-mono text-xl tabular-nums text-zinc-400">{profile?.total ?? 0}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted">total</p>
          </div>
        </div>
      </div>

      <TeamCard team={team} writesEnabled={TEAM_WRITES_ENABLED} maxMembers={TEAM_MAX_MEMBERS} />

      {!profile || profile.apps.length === 0 ? (
        <div className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] px-5 py-10 text-center">
          <p className="text-sm text-zinc-400">No scored PRs yet. Submit a patch to start earning points.</p>
          <Link href="/how-to-play" className="mt-3 inline-block text-sm ds-link">
            How to play →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {profile.apps.map((app) => {
            const meta = appsById[app.app];
            return (
              <div key={app.app} className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] p-4" style={{ ["--accent" as string]: meta.accent }}>
                <div className="flex items-center justify-between">
                  <p className="font-medium" style={{ color: meta.accent }}>
                    {meta.name}
                  </p>
                  {/* Sources without per-app point data (lambda) report
                      maxPoints 0 — showing "0 / 0 pts" reads as broken, so
                      only render the stat when it exists. The patched/total
                      line below covers progress either way. */}
                  {app.maxPoints > 0 && (
                    <p className="font-mono text-sm text-zinc-400">
                      {app.points}
                      <span className="text-muted"> / {app.maxPoints} pts</span>
                    </p>
                  )}
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${app.total > 0 ? (app.patched / app.total) * 100 : 0}%`, background: meta.accent }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {app.patched} / {app.total} patched
                </p>
                {app.challenges && app.challenges.length > 0 && <AppChallengeList challenges={app.challenges} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
