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
import ModuleDetail from "@/components/module-detail";
import TeamCard from "@/components/team-card";
import type { AppId } from "@/lib/apps";
import { enabledAppsById } from "@/lib/apps";
import { auth } from "@/lib/auth";
import { getViewerHints } from "@/lib/hint-store";
import type { AppProgress, LeaderboardEntry, ModuleProgress } from "@/lib/leaderboard/types";
import { getLeaderboardSource } from "@/lib/leaderboard/source";
import { isModuleEnabled, type ModuleId } from "@/lib/modules";
import { getQuizTotals, listQuestions, type Question, type QuizTotal } from "@/lib/quiz-store";
import { getResolvedModules } from "@/lib/resolved-modules";
import { getViewerTeam, TEAM_MAX_MEMBERS, TEAM_WRITES_ENABLED } from "@/lib/team-store";
import { upstashPipeline } from "@/lib/upstash";
import { event } from "@/lib/site";

// TeamCard needs the captain login (to gate captain-only controls) and the
// current join code (to display it), neither of which `TeamInfo` carries.
// team-store.ts is owned by another task, so this reads the same
// `ctf:team:<slug>` hash fields directly instead of extending its exports.
// Live mode only — the mock cookie has no captain/join-code concept.
async function getTeamMeta(slug: string): Promise<{ captain: string | null; joinCode: string | null }> {
  if (!TEAM_WRITES_ENABLED) return { captain: null, joinCode: null };
  try {
    const [captainRes, codeRes] = await upstashPipeline([
      ["HGET", `ctf:team:${slug}`, "captain"],
      ["HGET", `ctf:team:${slug}`, "joinCode"],
    ]);
    return {
      captain: typeof captainRes.result === "string" && captainRes.result ? captainRes.result : null,
      joinCode: typeof codeRes.result === "string" && codeRes.result ? codeRes.result : null,
    };
  } catch {
    return { captain: null, joinCode: null };
  }
}

export const metadata: Metadata = {
  title: "Profile",
  // Generic on purpose — "challenges" is secure-development's own noun, and
  // this page must read cleanly on a quiz-only event too. Mirrors
  // leaderboard/page.tsx's equally module-agnostic description.
  description: `Your personal progress in ${event.name}.`,
};

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/");

  const login = (session.user as { login?: string }).login;
  if (!login) redirect("/");

  const quizEnabled = isModuleEnabled("quiz");
  const secureDevEnabled = isModuleEnabled("secure-development");

  // Quiz totals/questions are per-login and cheap to fetch here regardless of
  // board size (two HGETALLs — see getQuizTotals), but only when the module
  // is enabled: this must never read `ctf:quiz:*` when quiz is off.
  // `resolvedModules` (organizer-renamed titles) is what drives the
  // per-module breakdown below off the enabled-module LIST rather than a
  // per-module branch — see the module block loop.
  const [profile, storeTeam, viewerHints, quizTotals, quizQuestions, resolvedModules] = await Promise.all([
    getLeaderboardSource().getUser(login),
    getViewerTeam(login),
    getViewerHints(login),
    quizEnabled ? getQuizTotals() : Promise.resolve(new Map<string, QuizTotal>()),
    quizEnabled ? listQuestions() : Promise.resolve([] as Question[]),
    getResolvedModules(),
  ]);

  // Live/mock team membership from the store wins; fall back to whatever the
  // leaderboard source reports (only the mock fixture populates it today).
  const team =
    storeTeam ??
    (profile?.team ? { slug: profile.team, name: profile.teamName ?? profile.team, members: [] } : null);
  const effectiveTeam = team?.slug ?? null;
  const teamMeta = team ? await getTeamMeta(team.slug) : { captain: null, joinCode: null };
  const isCaptain = teamMeta.captain !== null && teamMeta.captain === login;
  // "Non-patched" = everything not yet fixed (failed runs + untouched
  // challenges) — deliberately not called "failed" so contestants who
  // haven't gotten to a challenge yet don't read it as losing.
  const nonPatched = profile ? Math.max(0, profile.total - profile.patched) : 0;
  // Hint spend is deducted and quiz points are added, in that order, as
  // overlays — the exact same math (and order) as the leaderboard's
  // withHintPenalties (subtract, floor at 0) followed by
  // withModuleContributions (add quiz points on top) — so the profile
  // matches the contestant's public row.
  const quizTotal = quizTotals.get(login);
  const quizPoints = quizTotal?.points ?? 0;
  const netPoints = Math.max(0, (profile?.points ?? 0) - viewerHints.spent) + quizPoints;
  // Sources without per-challenge point data (lambda/upstash) report
  // maxPoints 0 — fall back to patched/total so the bar still means something.
  const progressPct = !profile
    ? 0
    : profile.maxPoints > 0
      ? (netPoints / profile.maxPoints) * 100
      : profile.total > 0
        ? (profile.patched / profile.total) * 100
        : 0;

  // Only the apps the event actually enabled — same filter the per-app grid
  // used before this task, kept so a target an organizer turned off never
  // shows up in the breakdown just because a stale scored row mentions it.
  const appsRecord: Partial<Record<AppId, AppProgress>> = {};
  for (const app of profile?.apps ?? []) {
    if (enabledAppsById[app.app]) appsRecord[app.app] = app;
  }

  // Each enabled module's contribution, keyed the same way
  // `withModuleContributions` keys `LeaderboardEntry.modules` — this is what
  // drives the block loop below off the enabled-module LIST rather than a
  // per-module `if`/branch on this page. A module with nothing to show (no
  // apps attempted, no correct answers) contributes no entry and so renders
  // no block, mirroring the leaderboard's own gate.
  const moduleProgress: Partial<Record<ModuleId, ModuleProgress>> = {};
  if (secureDevEnabled && Object.keys(appsRecord).length > 0) {
    moduleProgress["secure-development"] = {
      // Hint-netted, same as the headline figure and the leaderboard's own
      // row (withHintPenalties runs before withModuleContributions attributes
      // this same number there) — raw scorer points here would let this
      // block's total disagree with both.
      points: Math.max(0, (profile?.points ?? 0) - viewerHints.spent),
      completed: profile?.patched ?? 0,
      lastActivityAt: profile?.updatedAt ?? null,
      detail: { kind: "secure-development", apps: appsRecord },
    };
  }
  if (quizEnabled && quizTotal && quizTotal.answered > 0) {
    moduleProgress["quiz"] = {
      points: quizTotal.points,
      completed: quizTotal.answered,
      lastActivityAt: quizTotal.lastAt,
      // Clamped to at least `answered`, mirroring module-contributions.ts's
      // quizModule — a deleted question or a failed `listQuestions` must
      // never make the denominator read smaller than the numerator.
      detail: { kind: "quiz", answered: quizTotal.answered, total: Math.max(quizQuestions.length, quizTotal.answered), points: quizTotal.points },
    };
  }
  // `ModuleDetail`/`AppBreakdown` (the same renderers the leaderboard uses)
  // take a `LeaderboardEntry`; this page only ever has a `UserProfile`, which
  // has no `modules` map, so a minimal stand-in is built here rather than
  // adding a second breakdown renderer for one page.
  const moduleEntry: LeaderboardEntry = {
    rank: 0,
    login,
    team: effectiveTeam,
    points: netPoints,
    patched: profile?.patched ?? 0,
    failed: profile?.failed ?? 0,
    total: profile?.total ?? 0,
    apps: appsRecord,
    updatedAt: profile?.updatedAt ?? null,
  };
  // A single-module event has nothing to disambiguate — see the identical
  // note in leaderboard.tsx's EntryRow, which this mirrors.
  const multiModule = resolvedModules.length > 1;
  const moduleBlocks = resolvedModules.filter((m) => moduleProgress[m.id]);

  return (
    <div className="flex flex-col gap-8">
      {/* "target" is secure-development's own noun (and trips the shared
          secure-dev vocabulary guard on a quiz-only event) — kept generic so
          this reads the same regardless of which modules are enabled. */}
      <PageHeader eyebrow="Agent dossier" title={login} description="Your personal progress this event." />

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
          {/* "patched"/"total" are secure-development's own vocabulary (a
              regression test passing on a submitted patch) — meaningless on
              an event that never enabled it, so this whole trio is gated the
              same way the per-app breakdown below is. */}
          {secureDevEnabled && (
            <>
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
            </>
          )}
        </div>
      </div>

      <TeamCard
        team={team}
        writesEnabled={TEAM_WRITES_ENABLED}
        maxMembers={TEAM_MAX_MEMBERS}
        isCaptain={isCaptain}
        captain={teamMeta.captain}
        joinCode={teamMeta.joinCode}
      />

      {/* Each enabled module's own contribution — driven off `moduleBlocks`
          (`resolvedModules` filtered to the ones with progress to show), NOT
          a per-module branch, so a third module needs no edit here. Reuses
          `ModuleDetail` (secure-development renders through `AppBreakdown`,
          same as an expanded leaderboard row) rather than a second
          breakdown renderer for this page. */}
      {moduleBlocks.length === 0 ? (
        <div className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] px-5 py-10 text-center">
          <p className="text-sm text-zinc-400">
            {secureDevEnabled
              ? "No scored PRs yet. Submit a patch to start earning points."
              : "No points yet — dive in below to get started."}
          </p>
          <Link href="/how-to-play" className="mt-3 inline-block text-sm ds-link">
            How to play →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {moduleBlocks.map((m) => (
            <div key={m.id} data-testid="module-block" className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] p-4">
              {multiModule && (
                <p className="mb-3 flex items-center justify-between text-xs uppercase tracking-wider text-muted">
                  <span>{m.title}</span>
                  <span className="font-mono text-sm text-zinc-300">{moduleProgress[m.id]!.points} pts</span>
                </p>
              )}
              {/* showPoints is unconditional here, not a per-module branch:
                  it only takes effect inside AppBreakdown (the
                  secure-development render path), so quiz's block silently
                  ignores it. It's what restores the per-app "30 / 60 pts"
                  figure the pre-module custom grid used to show. */}
              <ModuleDetail moduleId={m.id} progress={moduleProgress[m.id]!} entry={moduleEntry} showPoints />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
