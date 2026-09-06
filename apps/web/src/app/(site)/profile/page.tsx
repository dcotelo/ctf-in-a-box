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
import AppBreakdown from "@/components/app-breakdown";
import ProgressRow, { moduleUnit } from "@/components/progress/progress-row";
import ChallengeList, { type ProgressItem } from "@/components/progress/challenge-list";
import RemainingLine from "@/components/progress/remaining-line";
import TeamCard from "@/components/team-card";
import TeamProgress from "@/components/team-progress";
import type { AppId } from "@/lib/apps";
import { enabledAppsById } from "@/lib/apps";
import { auth } from "@/lib/auth";
import {
  getAiTotals,
  getViewerAi,
  listAiChallenges,
  type AiChallenge,
  type AiTotal,
  type ViewerAi,
} from "@/lib/ai-store";
import {
  getClassicTotals,
  getViewerClassic,
  listChallenges,
  type Challenge,
  type ClassicTotal,
  type ViewerClassic,
} from "@/lib/classic-store";
import { getViewerHints } from "@/lib/hint-store";
import type { AppProgress, LeaderboardEntry, ModuleProgress, TeamStanding } from "@/lib/leaderboard/types";
import { getLeaderboardSource } from "@/lib/leaderboard/source";
import { withHintPenalties } from "@/lib/leaderboard/hint-penalties";
import { withModuleContributions } from "@/lib/leaderboard/module-contributions";
import { withTeamStandings } from "@/lib/leaderboard/team-standings";
import { challengeTotal } from "@/lib/leaderboard/non-patched";
import { type ModuleId } from "@/lib/modules";
import { getQuizTotals, getViewerQuiz, listQuestions, type Question, type QuizTotal, type ViewerQuiz } from "@/lib/quiz-store";
import { getEnabledModuleIds } from "@/lib/enabled-modules";
import { getResolvedModules } from "@/lib/resolved-modules";
import { getViewerTeam, resolveTeamMaxMembers, TEAM_WRITES_ENABLED } from "@/lib/team-store";
import { teamKey } from "@/lib/team-keys";
import { getAdminSettings, effectiveRegistrationOpen } from "@/lib/admin-store";
import { upstashPipeline } from "@/lib/upstash";
import { event } from "@/lib/site";

// TeamCard needs the captain login (to gate captain-only controls) and the
// current join code (to display it), neither of which `TeamInfo` carries, so
// the two fields are read here from the team hash — one pipeline, both HGETs.
// The key comes from the shared `teamKey` builder (team-keys.ts, ADR 48), never
// an open-coded key string — that is how two readers of the same data drift
// apart, and team-keys.test.ts scans this file to keep it that way.
// Live mode only — the mock cookie has no captain/join-code concept.
async function getTeamMeta(slug: string): Promise<{ captain: string | null; joinCode: string | null }> {
  if (!TEAM_WRITES_ENABLED) return { captain: null, joinCode: null };
  try {
    const [captainRes, codeRes] = await upstashPipeline([
      ["HGET", teamKey(slug), "captain"],
      ["HGET", teamKey(slug), "joinCode"],
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

  const liveModules = await getEnabledModuleIds();
  const quizEnabled = liveModules.has("quiz");
  const classicEnabled = liveModules.has("classic");
  const aiEnabled = liveModules.has("ai");
  const secureDevEnabled = liveModules.has("secure-development");

  // Quiz/classic/ai totals and item lists are per-login and cheap to fetch
  // here regardless of board size (two HGETALLs each — see getQuizTotals /
  // getClassicTotals / getAiTotals), but only when the module is enabled:
  // this must never read `ctf:quiz:*` when quiz is off, nor `ctf:classic:*`
  // when classic is, nor `ctf:ai:*` when ai is. `resolvedModules`
  // (organizer-renamed titles) is what drives the per-module breakdown below
  // off the enabled-module LIST rather than a per-module branch — see the
  // module block loop.
  const [
    profile,
    storeTeam,
    viewerHints,
    quizTotals,
    quizQuestions,
    classicTotals,
    classicChallenges,
    aiTotals,
    aiChallenges,
    viewerQuiz,
    viewerClassic,
    viewerAi,
    resolvedModules,
    maxMembers,
    adminSettings,
  ] =
    await Promise.all([
      getLeaderboardSource().getUser(login),
      getViewerTeam(login),
      getViewerHints(login),
      quizEnabled ? getQuizTotals() : Promise.resolve(new Map<string, QuizTotal>()),
      quizEnabled ? listQuestions() : Promise.resolve([] as Question[]),
      classicEnabled ? getClassicTotals() : Promise.resolve(new Map<string, ClassicTotal>()),
      classicEnabled ? listChallenges() : Promise.resolve([] as Challenge[]),
      aiEnabled ? getAiTotals() : Promise.resolve(new Map<string, AiTotal>()),
      aiEnabled ? listAiChallenges() : Promise.resolve([] as AiChallenge[]),
      // The viewer's OWN per-item progress, for the blocks' Show-N lists —
      // the same reads the boards themselves make, module-gated identically.
      quizEnabled ? getViewerQuiz(login) : Promise.resolve<ViewerQuiz>({ answered: {}, attempts: {} }),
      classicEnabled ? getViewerClassic(login) : Promise.resolve<ViewerClassic>({ solved: {}, attempts: {} }),
      aiEnabled ? getViewerAi(login) : Promise.resolve<ViewerAi>({ solved: {}, attempts: {} }),
      getResolvedModules(),
      // The SAME resolver joinTeam uses. Reading TEAM_MAX_MEMBERS here instead
      // would advertise a limit the join path does not enforce — the split
      // ADR 31 records from the hint toggle. It rides along in this existing
      // Promise.all, so it costs no extra round-trip.
      resolveTeamMaxMembers(),
      // For the team card's registration-closed explanation. Same
      // read-and-explain the /join/<code> page does: the team routes are the
      // enforcement, this is so a teamless contestant sent here after
      // registration closed reads why, instead of forms that refuse them.
      // Fail-open like the routes' own reads: an error means "open".
      getAdminSettings().catch(() => null),
    ]);

  // Live/mock team membership from the store wins; fall back to whatever the
  // leaderboard source reports (only the mock fixture populates it today).
  const team =
    storeTeam ??
    (profile?.team ? { slug: profile.team, name: profile.teamName ?? profile.team, members: [] } : null);
  const effectiveTeam = team?.slug ?? null;
  const teamMeta = team ? await getTeamMeta(team.slug) : { captain: null, joinCode: null };

  // The team's scoring picture, from the SAME pipeline (and the same overlay
  // order) the public leaderboard runs, so the panel and the board can never
  // disagree about the team's total. A failed read drops the panel, never the
  // page — this is a progress display, not a gate.
  let teamStanding: TeamStanding | null = null;
  let teamMemberEntries: { login: string; entry: LeaderboardEntry | null }[] = [];
  if (team) {
    try {
      const data = await getLeaderboardSource()
        .getLeaderboard()
        .then(withModuleContributions)
        .then(withTeamStandings)
        .then(withHintPenalties);
      teamStanding = data.teams.find((t) => t.slug === team.slug) ?? null;
      // The store's roster wins; the standing's member list covers the mock
      // fallback path where `team.members` arrives empty.
      const roster = team.members.length > 0 ? team.members : (teamStanding?.members ?? []);
      // Matched case-insensitively, like every other login join in this
      // codebase: the roster stores the spelling the team join recorded, the
      // board row the scorer's (PR author) — a disagreement must not render
      // a scoring teammate as 0 pts.
      teamMemberEntries = roster.map((member) => ({
        login: member,
        entry: data.entries.find((e) => e.login.toLowerCase() === member.toLowerCase()) ?? null,
      }));
    } catch {
      teamStanding = null;
    }
  }
  const isCaptain = teamMeta.captain !== null && teamMeta.captain === login;
  // Both derived through the SAME helper the public leaderboard row uses, so
  // a contestant's own dossier and their board row can't disagree about what
  // "non-patched" counts. This page used to compute it off `profile.total` —
  // the number of challenges with a scored result — which made a contestant
  // with nothing submitted read `0 non-patched / 0 total` on an event with a
  // full catalogue to work through.
  const patchedCount = profile?.patched ?? 0;
  const challengeCount = challengeTotal(profile?.total ?? 0);
  // Hint spend is deducted and the app-side modules' points are added, in that
  // order, as overlays — the exact same math (and order) as the leaderboard's
  // withHintPenalties (subtract, floor at 0) followed by
  // withModuleContributions (add quiz and classic points on top) — so the
  // profile matches the contestant's public row.
  const quizTotal = quizTotals.get(login);
  const quizPoints = quizTotal?.points ?? 0;
  const classicTotal = classicTotals.get(login);
  const classicPoints = classicTotal?.points ?? 0;
  const aiTotal = aiTotals.get(login);
  const aiPoints = aiTotal?.points ?? 0;
  // Net-of-hints TOTAL: the penalty subtracts from the all-module sum,
  // floored at 0 — the same math (and the same single application) as the
  // board's withHintPenalties, which now runs as the pipeline's LAST stage.
  // Netting scorer points alone (the old form) made hints free whenever the
  // spend exceeded scorer points — every classic-, quiz-, or ai-heavy
  // contestant.
  const netPoints = Math.max(0, (profile?.points ?? 0) + quizPoints + classicPoints + aiPoints - viewerHints.spent);
  // The bar's denominator covers every enabled module, because its numerator
  // does: netPoints already includes quiz and classic. Dividing an all-module
  // numerator by secure-development's maxPoints alone (the old behaviour) let
  // the two drift — a quiz-heavy contestant's bar understated them against a
  // ceiling they weren't playing toward (issue #200, 2.4). Clamped because a
  // deleted question/challenge deliberately leaves banked points in place, so
  // the numerator can legitimately exceed a shrunken denominator.
  const quizMaxPoints = quizQuestions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);
  const classicMaxPoints = classicChallenges.reduce((sum, c) => sum + (Number(c.points) || 0), 0);
  const aiMaxPoints = aiChallenges.reduce((sum, c) => sum + (Number(c.points) || 0), 0);
  const maxPointsAllModules = (profile?.maxPoints ?? 0) + quizMaxPoints + classicMaxPoints + aiMaxPoints;
  // Sources without per-challenge point data (lambda/upstash) report
  // maxPoints 0 — fall back to patched/total so the bar still means something.
  const progressPct =
    maxPointsAllModules > 0
      ? Math.min(100, (netPoints / maxPointsAllModules) * 100)
      : challengeCount > 0
        ? (patchedCount / challengeCount) * 100
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
      // GROSS scorer points, same as the leaderboard's own module block —
      // the hint penalty nets the TOTAL exactly once (headline + the −spent
      // tile), never a module's block, matching the board's fold order.
      points: profile?.points ?? 0,
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
  if (classicEnabled && classicTotal && classicTotal.solved > 0) {
    moduleProgress["classic"] = {
      points: classicTotal.points,
      completed: classicTotal.solved,
      lastActivityAt: classicTotal.lastAt,
      // Clamped to at least `solved`, mirroring module-contributions.ts's
      // classicModule — a deleted challenge (which deliberately leaves banked
      // points and the aggregate counter alone) must never make the
      // denominator read smaller than the numerator.
      detail: {
        kind: "classic",
        solved: classicTotal.solved,
        total: Math.max(classicChallenges.length, classicTotal.solved),
        points: classicTotal.points,
      },
    };
  }
  if (aiEnabled && aiTotal && aiTotal.solved > 0) {
    moduleProgress["ai"] = {
      points: aiTotal.points,
      completed: aiTotal.solved,
      lastActivityAt: aiTotal.lastAt,
      // Clamped to at least `solved`, mirroring module-contributions.ts's
      // aiModule — a deleted ai challenge (which deliberately leaves banked
      // points and the aggregate counter alone) must never make the
      // denominator read smaller than the numerator.
      detail: {
        kind: "ai",
        solved: aiTotal.solved,
        total: Math.max(aiChallenges.length, aiTotal.solved),
        points: aiTotal.points,
      },
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
  const moduleBlocks = resolvedModules.filter((m) => moduleProgress[m.id]);

  // What is still winnable, per ENABLED module rather than per module with a
  // block: a contestant who has not opened Classic yet is exactly the one who
  // needs to be told that most of the board's points are sitting in it. Each
  // pair is the same earned/max the module's own row shows.
  const moduleMaxPoints: Partial<Record<ModuleId, { earned: number; max: number }>> = {
    "secure-development": secureDevEnabled ? { earned: profile?.points ?? 0, max: profile?.maxPoints ?? 0 } : undefined,
    quiz: quizEnabled ? { earned: quizPoints, max: quizMaxPoints } : undefined,
    classic: classicEnabled ? { earned: classicPoints, max: classicMaxPoints } : undefined,
    ai: aiEnabled ? { earned: aiPoints, max: aiMaxPoints } : undefined,
  };
  const remainingModules = resolvedModules
    .map((m) => ({ title: m.title, ...moduleMaxPoints[m.id] }))
    .filter((m): m is { title: string; earned: number; max: number } => m.earned != null && m.max != null);

  // The shared progress shape's numbers, per module — each module's own noun,
  // its done/total pair, and its earned/available points. Denominators reuse
  // the same clamped figures computed above, so a block can never read
  // "6 / 5" or claim a ceiling the header bar doesn't.
  const moduleSummary = (id: ModuleId): { done: number; total: number; unit: string; earned: number; max: number } => {
    const progress = moduleProgress[id]!;
    const detail = progress.detail;
    // Exhaustive switch, closed with a `never` guard below — this used to be
    // an if/if/unconditional-return, which silently rendered any new
    // module's block with secure-development's numbers ("patched") and no
    // compiler complaint. A fourth `ModuleDetail` variant now fails to type
    // check here instead of shipping with the wrong noun.
    switch (detail.kind) {
      case "quiz":
        return { done: detail.answered, total: detail.total, unit: moduleUnit("quiz"), earned: progress.points, max: quizMaxPoints };
      case "classic":
        return { done: detail.solved, total: detail.total, unit: moduleUnit("classic"), earned: progress.points, max: classicMaxPoints };
      case "ai":
        return { done: detail.solved, total: detail.total, unit: moduleUnit("ai"), earned: progress.points, max: aiMaxPoints };
      case "secure-development":
        // `profile.maxPoints` is the sum of the targets' own ceilings (see
        // lambda/mock getUser) — it used to arrive as 0 from the live source,
        // which is what rendered "8 / 0 pts" here.
        return { done: progress.completed, total: challengeCount, unit: moduleUnit("secure-development"), earned: progress.points, max: profile?.maxPoints ?? 0 };
      default: {
        const unhandled: never = detail;
        return unhandled;
      }
    }
  };

  // Per-item rows for the quiz/classic blocks' Show-N lists — which questions
  // are answered, which flags are solved. Built FIELD BY FIELD from the
  // public records, never a spread of a store row (a classic record's
  // siblings include the flag; a quiz record's, the answer key). The
  // secure-development block already has its own per-target lists via
  // AppBreakdown.
  const moduleItems = (id: ModuleId): { items: ProgressItem[]; doneWord: string } | null => {
    // Classic groups by the category an organizer authored (Web, Crypto…);
    // quiz and ai have no grouping of their own and render one flat bucket.
    if (id === "quiz" && quizQuestions.length > 0) {
      return {
        doneWord: "answered",
        items: quizQuestions.map((qn) => {
          const done = Boolean(viewerQuiz.answered[qn.id]);
          return {
            key: qn.id,
            name: qn.prompt,
            points: viewerQuiz.answered[qn.id]?.points ?? qn.points,
            done,
            status: done ? "Answered" : "Open",
            tone: done ? "done" : "open",
          };
        }),
      };
    }
    if (id === "classic" && classicChallenges.length > 0) {
      return {
        doneWord: "solved",
        items: classicChallenges.map((c) => {
          const done = Boolean(viewerClassic.solved[c.id]);
          return {
            key: c.id,
            name: c.title,
            points: viewerClassic.solved[c.id]?.points ?? c.points,
            group: c.category,
            done,
            status: done ? "Solved" : "Open",
            tone: done ? "done" : "open",
          };
        }),
      };
    }
    if (id === "ai" && aiChallenges.length > 0) {
      return {
        doneWord: "cleared",
        items: aiChallenges.map((c) => {
          const done = Boolean(viewerAi.solved[c.id]);
          return {
            key: c.id,
            name: c.title,
            points: viewerAi.solved[c.id]?.points ?? c.points,
            done,
            status: done ? "Cleared" : "Open",
            tone: done ? "done" : "open",
          };
        }),
      };
    }
    return null;
  };

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
          {/* The bar says WHAT it measures — an unlabeled bar reads as
              decoration, and its denominator (every enabled module's points)
              is not guessable. Falls back to the same done/total pair the
              percentage itself falls back to. */}
          <p className="mt-1.5 font-mono text-[11px] tabular-nums text-muted">
            {maxPointsAllModules > 0
              ? `${netPoints.toLocaleString("en-US")} of ${maxPointsAllModules.toLocaleString("en-US")} pts available`
              : challengeCount > 0
                ? `${patchedCount} of ${challengeCount} done`
                : null}
          </p>
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
          {/* One done/available stat per enabled module, each in its module's
              own vocabulary. The old header was three secure-development
              figures (patched / non-patched / total) and nothing else — a
              contestant whose points were mostly quiz and flags got a header
              describing a game they weren't playing, opening with a wall of
              not-done ("315 non-patched") while their real progress sat
              below the fold (issue #200, 2.4). */}
          {secureDevEnabled && (
            <div>
              <p className="font-mono text-xl tabular-nums text-[#22c55e]">
                {patchedCount}
                <span className="text-sm text-muted"> / {challengeCount}</span>
              </p>
              <p className="text-[11px] uppercase tracking-wide text-muted">patched</p>
            </div>
          )}
          {quizEnabled && quizQuestions.length > 0 && (
            <div>
              <p className="font-mono text-xl tabular-nums text-zinc-200">
                {quizTotal?.answered ?? 0}
                <span className="text-sm text-muted"> / {Math.max(quizQuestions.length, quizTotal?.answered ?? 0)}</span>
              </p>
              <p className="text-[11px] uppercase tracking-wide text-muted">answered</p>
            </div>
          )}
          {classicEnabled && classicChallenges.length > 0 && (
            <div>
              <p className="font-mono text-xl tabular-nums text-zinc-200">
                {classicTotal?.solved ?? 0}
                <span className="text-sm text-muted"> / {Math.max(classicChallenges.length, classicTotal?.solved ?? 0)}</span>
              </p>
              <p className="text-[11px] uppercase tracking-wide text-muted">{moduleUnit("classic")}</p>
            </div>
          )}
          {aiEnabled && aiChallenges.length > 0 && (
            <div>
              <p className="font-mono text-xl tabular-nums text-zinc-200">
                {aiTotal?.solved ?? 0}
                <span className="text-sm text-muted"> / {Math.max(aiChallenges.length, aiTotal?.solved ?? 0)}</span>
              </p>
              {/* "challenges" until now, which is what classic's flags are
                  called too — every header stat takes its module's own word
                  from the shared map. */}
              <p className="text-[11px] uppercase tracking-wide text-muted">{moduleUnit("ai")}</p>
            </div>
          )}
        </div>
      </div>

      {/* `#team` is the target `redirectIfTeamless` sends a teamless
          contestant to (lib/require-team.ts). Without it they land at the top
          of a page of stats with no indication of why they were moved.
          `scroll-mt-*` keeps the card clear of the sticky header. */}
      <div id="team" className="scroll-mt-24 flex flex-col gap-4">
        <TeamCard
          team={team}
          writesEnabled={TEAM_WRITES_ENABLED}
          maxMembers={maxMembers}
          isCaptain={isCaptain}
          captain={teamMeta.captain}
          joinCode={teamMeta.joinCode}
          registrationOpen={adminSettings === null ? true : effectiveRegistrationOpen(adminSettings)}
        />
        {teamStanding && teamMemberEntries.length > 0 && (
          <TeamProgress
            standing={teamStanding}
            memberEntries={teamMemberEntries}
            viewerLogin={login}
          />
        )}
      </div>

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
          {moduleBlocks.map((m) => {
            const summary = moduleSummary(m.id);
            const list = moduleItems(m.id);
            const isSecureDev = moduleProgress[m.id]!.detail.kind === "secure-development";
            // One row shape at every level: the module row opens into its
            // targets (secure-development) or straight into its own grouped
            // list. The title is redundant on a single-module event, but the
            // row still needs a label for its bar, so the module's own name
            // stands in rather than the row losing its accessible name.
            return (
              <div key={m.id} data-testid="module-block" className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] p-4">
                <ProgressRow label={m.title} level="module" {...summary}>
                  {isSecureDev ? (
                    <AppBreakdown entry={moduleEntry} showPoints />
                  ) : list ? (
                    <ChallengeList items={list.items} unit={summary.unit} doneWord={list.doneWord} />
                  ) : undefined}
                </ProgressRow>
              </div>
            );
          })}
          {/* The one line here that is not a restatement: what is still
              winnable, and where most of it is. Everything above answers
              "how am I doing"; a contestant mid-event is asking "where do I
              go next". */}
          <RemainingLine modules={remainingModules} />
        </div>
      )}
    </div>
  );
}
